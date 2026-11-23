/* Cloud sync for Account Manager (Firebase Auth + Firestore).
 * Local-first: the app always reads/writes its local copy; this module mirrors
 * changes to Firestore (queued offline by the SDK) and applies remote changes.
 * Data layout: users/{uid} (profile: settings + categories)
 *              users/{uid}/{accounts|transactions|fds|assets}/{recordId}
 */
'use strict';
window.Cloud = (() => {
  const COLS = ['accounts', 'transactions', 'fds', 'assets', 'ppf', 'documents', 'recurring', 'policies', 'goals', 'bills', 'warranties', 'vehicles'];
  const CFG_KEY = 'acctmgr.firebaseConfig';
  const OWNER_KEY = 'acctmgr.owner';
  let api = null, auth = null, db = null, user = null, ready = false;
  let unsubs = [], last = {}, lastProfile = '';
  const pendingBy = {};
  const status = { state: 'off', pending: false, fromCache: false, error: '' };

  // Deterministic JSON (sorted keys, undefined dropped) so local vs cloud compare reliably.
  const stable = (v) => Array.isArray(v) ? '[' + v.map((x) => (x === undefined ? 'null' : stable(x))).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
      : JSON.stringify(v === undefined ? null : v);
  const profileOf = (S) => ({
    settings: { name: S.settings.name || '', currency: S.settings.currency || 'INR', inboxToken: S.settings.inboxToken || '' },
    categories: S.categories, budgets: S.budgets || {}, emergency: S.emergency || {}, smsLearn: S.smsLearn || {},
  });
  const profileFromDoc = (d, S) => ({ settings: d.settings || {}, categories: d.categories || S.categories, budgets: d.budgets || {}, emergency: d.emergency || {}, smsLearn: d.smsLearn || {} });
  const sameMap = (a, b) => { if (!b || a.size !== b.size) return false; for (const [k, v] of a) if (b.get(k) !== v) return false; return true; };

  function storedConfig() { try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return c && c.apiKey ? c : null; } catch { return null; } }
  function config() { return (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) ? window.FIREBASE_CONFIG : storedConfig(); }

  /** Accepts the JSON or the JS snippet Firebase console shows (`const firebaseConfig = {...}`). */
  function parseConfig(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not find { … } in what you pasted.');
    const s = m[0].replace(/^\s*\/\/.*$/gm, '')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"').replace(/,\s*}/g, '}');
    const c = JSON.parse(s);
    if (!c.apiKey || !c.projectId) throw new Error('Config must include apiKey and projectId.');
    return c;
  }

  const friendly = (e) => {
    const map = {
      'auth/invalid-credential': 'Wrong email or password.\n\nNew here? Tap “Create account” instead of “Sign in”.\nForgot your password? Tap “Forgot password?” to get a reset link by email.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with this email yet. Tap “Create account”.',
      'auth/email-already-in-use': 'An account with this email already exists — sign in instead.', 'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/invalid-email': 'Enter a valid email address.', 'auth/missing-password': 'Enter your password.', 'auth/network-request-failed': 'No internet connection.',
      'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
      'auth/operation-not-allowed': 'Email/Password sign-in is not enabled in the Firebase console (Authentication → Sign-in method).',
      'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase config is invalid (bad apiKey).',
      'permission-denied': 'Cloud database refused access — check the Firestore security rules.',
    };
    return map[e && e.code] || (e && e.message) || String(e);
  };

  function init(a) {
    api = a;
    if (typeof firebase === 'undefined') { status.state = 'off'; return; }
    const cfg = config();
    if (!cfg) { status.state = 'unconfigured'; return; }
    try {
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.firestore();
      db.settings({ ignoreUndefinedProperties: true });
      if (window.FIREBASE_EMULATOR) { // used only by automated tests
        auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        db.useEmulator('127.0.0.1', 8085);
      }
      db.enablePersistence({ synchronizeTabs: true }).catch((e) => console.warn('Offline cache unavailable:', e.code));
    } catch (e) { status.state = 'unconfigured'; status.error = friendly(e); return; }
    status.state = 'signedout';
    auth.onAuthStateChanged((u) => {
      stop(); user = u;
      if (u) { status.state = 'syncing'; status.error = ''; connect().catch((e) => { status.error = friendly(e); api.statusChanged(); }); }
      else status.state = 'signedout';
      api.render();
    });
    window.addEventListener('online', () => api.statusChanged());
    window.addEventListener('offline', () => api.statusChanged());
  }

  function stop() { if (inboxUnsub) { inboxUnsub(); inboxUnsub = null; } unsubs.forEach((u) => u()); unsubs = []; ready = false; last = {}; lastProfile = ''; }
  const root = () => db.collection('users').doc(user.uid);

  function meaningful(S) {
    if (S.transactions.length || S.fds.length || S.assets.length || (S.ppf || []).length || (S.documents || []).length || (S.bills || []).length || (S.vehicles || []).length) return true;
    return S.accounts.length > 1 || S.accounts.some((a) => Number(a.openingBalance) || a.accountNumber);
  }

  async function connect() {
    const r = root();
    const get = async (ref) => { try { return await ref.get(); } catch (e) { if (e.code === 'permission-denied') throw e; try { return await ref.get({ source: 'cache' }); } catch { return null; } } };
    const [prof, ...snaps] = await Promise.all([get(r), ...COLS.map((c) => get(r.collection(c)))]);
    if (!user || user.uid !== (auth.currentUser && auth.currentUser.uid)) return; // signed out meanwhile
    const S = api.getState();
    const owner = localStorage.getItem(OWNER_KEY);
    const ok = prof && snaps.every(Boolean);
    let next = S;
    if (ok) {
      const cloud = {}; COLS.forEach((c, i) => { cloud[c] = snaps[i].docs.map((d) => d.data()); });
      const cp = prof.exists ? prof.data() : null;
      const cloudEmpty = !cp && COLS.every((c) => !cloud[c].length);
      COLS.forEach((c) => { last[c] = new Map(cloud[c].map((x) => [x.id, stable(x)])); });
      lastProfile = cp ? stable(profileOf(profileFromDoc(cp, S))) : '';
      const fromCloud = () => ({ ...S, ...cloud, settings: { ...S.settings, ...((cp && cp.settings) || {}) }, categories: (cp && cp.categories) || S.categories, budgets: (cp && cp.budgets) || {}, emergency: (cp && cp.emergency) || S.emergency, smsLearn: (cp && cp.smsLearn) || {} });
      if (owner === user.uid) next = fromCloud();
      else if (cloudEmpty) next = S; // first sign-in: upload this device's data
      else if (!owner && meaningful(S) && confirm('Your cloud account already has data.\n\nMerge the data on this device into it?\n\nOK = merge both\nCancel = use only the cloud data')) {
        next = fromCloud();
        COLS.forEach((c) => { const ids = new Set(next[c].map((x) => x.id)); next[c] = next[c].concat(S[c].filter((x) => !ids.has(x.id))); });
        ['income', 'expense'].forEach((k) => { next.categories[k] = [...new Set([...(next.categories[k] || []), ...(S.categories[k] || [])])]; });
        next.budgets = { ...(S.budgets || {}), ...(next.budgets || {}) };
        next.smsLearn = { ...(S.smsLearn || {}), ...(next.smsLearn || {}) };
      } else next = fromCloud();
    }
    api.setState(next);
    localStorage.setItem(OWNER_KEY, user.uid);
    ready = true;
    push();
    listen();
    if (api.onReady) api.onReady();
  }

  function listen() {
    const r = root();
    const onErr = (e) => { status.error = friendly(e); api.statusChanged(); };
    const meta = (key, snap) => {
      pendingBy[key] = snap.metadata.hasPendingWrites;
      status.pending = Object.values(pendingBy).some(Boolean);
      status.fromCache = snap.metadata.fromCache;
      status.state = 'synced';
      if (!snap.metadata.fromCache) status.error = '';
    };
    COLS.forEach((c) => unsubs.push(r.collection(c).onSnapshot({ includeMetadataChanges: true }, (snap) => {
      meta(c, snap);
      const map = new Map(snap.docs.map((d) => [d.id, stable(d.data())]));
      if (!sameMap(map, last[c])) {
        last[c] = map;
        const S = api.getState();
        S[c] = [...map.values()].map((s) => JSON.parse(s));
        api.setState(S);
      }
      api.statusChanged();
    }, onErr)));
    unsubs.push(r.onSnapshot({ includeMetadataChanges: true }, (snap) => {
      meta('profile', snap);
      if (snap.exists) {
        const d = snap.data(); const S = api.getState();
        const p = stable(profileOf(profileFromDoc(d, S)));
        if (p !== lastProfile) {
          lastProfile = p;
          S.settings = { ...S.settings, ...(d.settings || {}) };
          if (d.categories) S.categories = d.categories;
          S.budgets = d.budgets || {};
          S.emergency = d.emergency || S.emergency;
          S.smsLearn = d.smsLearn || {};
          api.setState(S);
        }
      }
      api.statusChanged();
    }, onErr));
  }

  /** Called after every local save: send only what changed since the last sync. */
  function push() {
    if (!ready || !user) return;
    const S = api.getState(), r = root(), ops = [];
    COLS.forEach((c) => {
      const cur = new Map(S[c].map((x) => [x.id, stable(x)]));
      const prev = last[c] || new Map();
      cur.forEach((s, id) => { if (prev.get(id) !== s) ops.push((b) => b.set(r.collection(c).doc(id), JSON.parse(s))); });
      prev.forEach((_, id) => { if (!cur.has(id)) ops.push((b) => b.delete(r.collection(c).doc(id))); });
      last[c] = cur;
    });
    const p = stable(profileOf(S));
    if (p !== lastProfile) { lastProfile = p; ops.push((b) => b.set(r, JSON.parse(p))); }
    for (let i = 0; i < ops.length; i += 400) {
      const b = db.batch();
      ops.slice(i, i + 400).forEach((f) => f(b));
      b.commit().catch((e) => { status.error = friendly(e); api.toast('Cloud sync failed: ' + status.error); api.statusChanged(); });
    }
    if (ops.length) { status.pending = true; api.statusChanged(); }
  }

  // ----- Document files: stored as ~800 KB binary chunks in users/{uid}/files/{docId}_{n} -----
  function uploadFile(id, u8, chunk) {
    if (!user) return Promise.reject(new Error('Not signed in'));
    const col = root().collection('files');
    const n = Math.max(1, Math.ceil(u8.length / chunk));
    const writes = [];
    for (let i = 0; i < n; i++) writes.push(col.doc(`${id}_${i}`).set({ i, n, d: firebase.firestore.Blob.fromUint8Array(u8.slice(i * chunk, (i + 1) * chunk)) }));
    status.pending = true; api.statusChanged();
    return Promise.all(writes).catch((e) => { throw new Error(friendly(e)); });
  }
  async function downloadFile(id, n) {
    if (!user) throw new Error('Sign in to download this file.');
    const col = root().collection('files');
    let snaps;
    try { snaps = await Promise.all(Array.from({ length: n }, (_, i) => col.doc(`${id}_${i}`).get())); }
    catch (e) { throw new Error(e.code === 'unavailable' ? 'You are offline and this file is not saved on this device yet. Try again when online.' : friendly(e)); }
    if (snaps.some((x) => !x.exists)) throw new Error('This file has not finished uploading from your other device yet. Open the app there while online, then try again.');
    const parts = snaps.map((x) => x.data().d.toUint8Array());
    const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
    let o = 0; parts.forEach((x) => { out.set(x, o); o += x.length; });
    return out;
  }
  function deleteFile(id, n) {
    if (!user) return;
    const col = root().collection('files');
    for (let i = 0; i < (n || 1); i++) col.doc(`${id}_${i}`).delete().catch(() => {});
  }

  // ----- SMS inbox: users/{uid} profile holds a secret token; inbox/{token}/items gets messages from the phone -----
  let inboxUnsub = null, inboxRetry = 0;
  function watchInbox(token, cb) {
    if (inboxUnsub) { inboxUnsub(); inboxUnsub = null; }
    if (!user || !token) return;
    inboxUnsub = db.collection('inbox').doc(token).collection('items').onSnapshot((snap) => {
      inboxRetry = 0;
      cb(snap.docs.map((d) => ({ id: d.id, text: d.data().text || '', at: d.data().at || '' })));
    }, (e) => {
      // The profile with the new token may not have reached the server yet: retry a few times.
      inboxUnsub = null;
      if (inboxRetry++ < 6) setTimeout(() => watchInbox(token, cb), 4000 * inboxRetry);
      else console.warn('SMS inbox unavailable:', e.code);
    });
  }
  function claimInbox(token) {
    if (!user || !token) return Promise.reject(new Error('Not signed in'));
    return db.collection('inboxOwners').doc(token).set({ uid: user.uid });
  }
  function deleteInboxItem(token, id) { if (user && token) db.collection('inbox').doc(token).collection('items').doc(id).delete().catch(() => {}); }
  function inboxUrl(token) {
    const c = config();
    const base = window.FIREBASE_EMULATOR ? 'http://127.0.0.1:8085' : 'https://firestore.googleapis.com';
    return `${base}/v1/projects/${c.projectId}/databases/(default)/documents/inbox/${token}/items?key=${c.apiKey}`;
  }

  // ----- Account actions -----
  async function signIn(email, pw) { try { await auth.signInWithEmailAndPassword(email.trim(), pw); } catch (e) { throw new Error(friendly(e)); } }
  async function signUp(email, pw) { try { await auth.createUserWithEmailAndPassword(email.trim(), pw); } catch (e) { throw new Error(friendly(e)); } }
  async function resetPassword(email) { try { await auth.sendPasswordResetEmail(email.trim()); } catch (e) { throw new Error(friendly(e)); } }
  async function signOut() {
    if (status.pending && !navigator.onLine) throw new Error('You have changes that are not uploaded yet. Connect to the internet first, then sign out.');
    try { await Promise.race([db.waitForPendingWrites(), new Promise((res) => setTimeout(res, 6000))]); } catch {}
    stop();
    await auth.signOut();
    localStorage.removeItem(OWNER_KEY);
    api.setState(null); // clear this device; data stays in the cloud
  }
  function saveConfig(text) { const c = parseConfig(text); localStorage.setItem(CFG_KEY, JSON.stringify(c)); return c; }
  function clearConfig() { localStorage.removeItem(CFG_KEY); }

  return {
    init, push, uploadFile, downloadFile, deleteFile, watchInbox, claimInbox, deleteInboxItem, inboxUrl, signIn, signUp, resetPassword, signOut, saveConfig, clearConfig,
    get user() { return user; }, get status() { return status; },
    get configSource() { return (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) ? 'built-in' : storedConfig() ? 'device' : null; },
    get projectId() { const c = config(); return c ? c.projectId : ''; },
  };
})();
