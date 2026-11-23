/* Account Manager — offline-first personal finance app.
 * All data lives on this device (localStorage). Use More → Backup to export/import.
 */
'use strict';
(() => {
  // ---------- Utilities ----------
  const KEY = 'acctmgr.data.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const iso = (d = new Date()) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const daysBetween = (a, b) => Math.round((b - a) / 864e5);
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const sum = (arr) => arr.reduce((s, t) => s + num(t.amount), 0);
  const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = (name) => native() && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null;

  const ACCOUNT_TYPES = {
    bank: { label: 'Bank Account', icon: '🏦' },
    cash: { label: 'Cash', icon: '💵' },
    wallet: { label: 'Wallet / UPI', icon: '📱' },
    credit: { label: 'Credit Card', icon: '💳' },
    other: { label: 'Other', icon: '🗂️' },
  };
  const ASSET_CATS = ['Gold', 'Property', 'Stocks', 'Mutual Funds', 'PPF', 'EPF', 'NPS', 'Bonds', 'Crypto', 'Vehicle', 'Loan Given', 'Other'];
  const LIAB_CATS = ['Home Loan', 'Car Loan', 'Personal Loan', 'Education Loan', 'Gold Loan', 'Borrowed', 'Other'];
  const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];
  const COMPOUND = { monthly: 12, quarterly: 4, 'half-yearly': 2, yearly: 1 };

  const defaultData = () => ({
    version: 1,
    settings: { currency: 'INR', name: '', lastBackup: null },
    accounts: [{ id: uid(), name: 'Cash in Hand', type: 'cash', openingBalance: 0, includeNW: true }],
    transactions: [],
    fds: [],
    assets: [],
    ppf: [],
    documents: [],
    recurring: [],
    policies: [],
    goals: [],
    bills: [],
    warranties: [],
    vehicles: [],
    budgets: {},
    emergency: { notes: '', contacts: [] },
    smsLearn: {},
    categories: {
      income: ['Salary', 'Business', 'Freelance', 'Interest', 'Dividend', 'Rent Received', 'Refund', 'Gift', 'Other'],
      expense: ['Food & Dining', 'Groceries', 'Rent', 'Transport', 'Fuel', 'Shopping', 'Bills & Utilities', 'Mobile & Internet',
        'Health', 'Education', 'Entertainment', 'Travel', 'EMI', 'Insurance', 'Investment', 'Personal Care', 'Family', 'Other'],
    },
  });

  function migrate(d) {
    const base = defaultData();
    d = d && typeof d === 'object' ? d : base;
    d.settings = Object.assign({}, base.settings, d.settings);
    d.accounts = Array.isArray(d.accounts) ? d.accounts : [];
    d.transactions = Array.isArray(d.transactions) ? d.transactions : [];
    d.fds = Array.isArray(d.fds) ? d.fds : [];
    d.assets = Array.isArray(d.assets) ? d.assets : [];
    ['ppf', 'documents', 'recurring', 'policies', 'goals', 'bills', 'warranties', 'vehicles'].forEach((k) => { d[k] = Array.isArray(d[k]) ? d[k] : []; });
    d.emergency = Object.assign({ notes: '', contacts: [] }, d.emergency || {});
    if (!Array.isArray(d.emergency.contacts)) d.emergency.contacts = [];
    d.smsLearn = d.smsLearn && typeof d.smsLearn === 'object' ? d.smsLearn : {};
    d.budgets = d.budgets && typeof d.budgets === 'object' && !Array.isArray(d.budgets) ? d.budgets : {};
    d.categories = Object.assign({}, base.categories, d.categories);
    d.version = 1;
    return d;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.error(e); }
    return defaultData();
  }
  let S = load();
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { alert('Could not save data: ' + e.message); }
  }
  function save() {
    saveLocal();
    if (window.Cloud) window.Cloud.push();
  }
  const signedIn = () => !!(window.Cloud && window.Cloud.user);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- Formatting ----------
  const fmtCache = {};
  function fmt(n) {
    const cur = S.settings.currency || 'INR';
    const r = Math.round(num(n) * 100) / 100;
    const dec = Number.isInteger(r) ? 0 : 2;
    const k = cur + dec;
    if (!fmtCache[k]) {
      try { fmtCache[k] = new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: cur, minimumFractionDigits: dec, maximumFractionDigits: dec }); }
      catch { fmtCache[k] = { format: (x) => cur + ' ' + x.toFixed(dec) }; }
    }
    return fmtCache[k].format(r);
  }
  function compact(n) {
    const cur = S.settings.currency || 'INR';
    try { return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
    catch { return String(Math.round(n)); }
  }
  const money = (n, cls = '') => `<span class="amt ${cls}">${esc(fmt(n))}</span>`;
  const fmtDate = (s) => s ? parseDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const monthLabel = (m) => parseDate(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const shiftMonth = (m, by) => { const d = parseDate(m + '-01'); d.setMonth(d.getMonth() + by); return iso(d).slice(0, 7); };
  const mask = (s) => { s = String(s || ''); return s.length > 4 ? '•••• ' + s.slice(-4) : s; };

  // ---------- Calculations ----------
  function balances(upTo) {
    const b = {};
    S.accounts.forEach((a) => { b[a.id] = num(a.openingBalance); });
    for (const t of S.transactions) {
      if (upTo && t.date > upTo) continue;
      const amt = num(t.amount);
      if (t.type === 'income') b[t.accountId] = (b[t.accountId] || 0) + amt;
      else if (t.type === 'expense') b[t.accountId] = (b[t.accountId] || 0) - amt;
      else if (t.type === 'transfer') {
        b[t.accountId] = (b[t.accountId] || 0) - amt;
        b[t.toAccountId] = (b[t.toAccountId] || 0) + amt;
      }
    }
    return b;
  }

  function addTenure(start, months, days) {
    const d = new Date(start.getFullYear(), start.getMonth() + months, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(start.getDate(), last));
    d.setDate(d.getDate() + days);
    return d;
  }

  function fdCalc(f, asOf = new Date()) {
    const P = num(f.principal), r = num(f.rate) / 100;
    const start = parseDate(f.startDate || iso());
    const mat = addTenure(start, num(f.tenureMonths), num(f.tenureDays));
    const total = Math.max(daysBetween(start, mat), 0);
    const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
    const elapsed = Math.min(Math.max(daysBetween(start, today), 0), total);
    const n = COMPOUND[f.compounding] || 0;
    const growth = (d) => { const t = d / 365; return n ? P * Math.pow(1 + r / n, n * t) : P * (1 + r * t); };
    let maturity, current, interest, payoutAmt = 0;
    if (f.payout && f.payout !== 'cumulative') {
      payoutAmt = (P * r) / (COMPOUND[f.payout] || 12);
      maturity = P; current = P; interest = (P * r * total) / 365;
    } else {
      const override = num(f.maturityOverride);
      maturity = override > 0 ? override : growth(total);
      if (elapsed >= total) current = maturity;
      else if (override > 0 && P > 0 && total > 0) current = P * Math.pow(maturity / P, elapsed / total);
      else current = growth(elapsed);
      interest = maturity - P;
    }
    return { mat, matISO: iso(mat), maturity, current, interest, payoutAmt, daysLeft: daysBetween(today, mat), progress: total ? elapsed / total : 1, total };
  }

  function netWorth() {
    const b = balances();
    let accAssets = 0, accLiab = 0;
    S.accounts.filter((a) => a.includeNW !== false).forEach((a) => {
      const v = b[a.id] || 0;
      if (v >= 0) accAssets += v; else accLiab += -v;
    });
    let fd = 0;
    S.fds.filter((f) => f.status !== 'closed').forEach((f) => { fd += fdCalc(f).current; });
    let ppf = 0;
    S.ppf.filter((p) => p.status !== 'closed').forEach((p) => { ppf += ppfCalc(p).current; });
    let other = 0, liab = 0;
    S.assets.forEach((x) => { if (x.kind === 'liability') liab += num(x.value); else other += num(x.value); });
    S.policies.forEach((x) => { if (policyActive(x)) other += num(x.value); });
    const assets = accAssets + fd + ppf + other, liabilities = accLiab + liab;
    return { accAssets, accLiab, fd, ppf, other, liab, assets, liabilities, total: assets - liabilities };
  }

  const accName = (id) => { const a = S.accounts.find((x) => x.id === id); return a ? a.name : '(deleted)'; };
  const accIcon = (a) => (ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.other).icon;

  // ---------- State / navigation ----------
  const st = { tab: 'home', sub: null, month: iso().slice(0, 7), filter: { account: '', type: '', mode: '', q: '', docq: '' }, fdTab: 'active', investTab: 'fd', docCat: '', reveal: {} };

  const ICON = {
    in: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7 7 7-7"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7-7 7 7"/></svg>',
    xfer: '<svg viewBox="0 0 24 24"><path d="M7 7h13l-4-4M17 17H4l4 4"/></svg>',
    chev: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;color:var(--muted)"><path d="M9 6l6 6-6 6"/></svg>',
  };

  function go(tab) { st.tab = tab; st.sub = null; render(); window.scrollTo(0, 0); }
  function openSub(sub) { st.sub = sub; render(); window.scrollTo(0, 0); }
  function back() { st.sub = null; render(); }

  // ---------- Views ----------
  function txnRow(t, showAcc = true) {
    const isIn = t.type === 'income', isX = t.type === 'transfer';
    const icon = isX ? ICON.xfer : isIn ? ICON.in : ICON.out;
    const title = isX ? 'Transfer' : esc(t.category || (isIn ? 'Income' : 'Expense'));
    const ml = !isX && t.mode ? MODE_LABEL[t.mode] || '' : '';
    const sub = isX ? `${esc(accName(t.accountId))} → ${esc(accName(t.toAccountId))}` : [showAcc ? esc(accName(t.accountId)) : '', ml].filter(Boolean).join(' · ');
    const note = t.note ? `<div class="sub ellipsis">${esc(t.note)}</div>` : '';
    const amt = isX ? money(t.amount) : isIn ? money(t.amount, 'pos') : money(-num(t.amount), 'neg');
    return `<button class="item" data-act="edit-txn" data-id="${t.id}">
      <div class="avatar ${t.type}">${icon}</div>
      <div class="grow"><div class="title ellipsis">${title}${t.recurringId ? ' <span title="Recurring">🔁</span>' : ''}${t.receiptId ? ' <span title="Receipt attached">📎</span>' : ''}${t.fromSms ? ' <span title="Added from SMS">📩</span>' : ''}</div>${sub ? `<div class="sub ellipsis">${sub}</div>` : ''}${note}</div>
      <div class="right"><b>${isIn ? '+' : ''}${amt}</b></div></button>`;
  }

  function groupedTxns(list, showAcc = true) {
    if (!list.length) return `<div class="list"><div class="empty"><div class="em">🧾</div>No entries yet.<br><span class="small">Tap + to add income or expense.</span></div></div>`;
    const sorted = [...list].sort((a, b) => (b.date + (b.created || '')).localeCompare(a.date + (a.created || '')));
    let html = '<div class="list">', cur = null;
    for (const t of sorted) {
      if (t.date !== cur) {
        cur = t.date;
        const day = sorted.filter((x) => x.date === cur);
        const net = day.reduce((s, x) => s + (x.type === 'income' ? num(x.amount) : x.type === 'expense' ? -num(x.amount) : 0), 0);
        html += `<div class="day-head"><span>${fmtDate(cur)}</span><span class="amt">${net ? (net > 0 ? '+' : '') + esc(fmt(net)) : ''}</span></div>`;
      }
      html += txnRow(t, showAcc);
    }
    return html + '</div>';
  }

  function monthNav() {
    return `<div class="monthnav">
      <button data-act="month" data-by="-1" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <b>${monthLabel(st.month)}</b>
      <button data-act="month" data-by="1" aria-label="Next month"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
  }

  function viewHome() {
    const nw = netWorth();
    const tx = S.transactions.filter((t) => t.date.slice(0, 7) === st.month);
    const inc = sum(tx.filter((t) => t.type === 'income'));
    const exp = sum(tx.filter((t) => t.type === 'expense'));
    let html = '';

    // Backup reminder
    const hasData = S.transactions.length + S.fds.length + S.assets.length > 0;
    const last = S.settings.lastBackup;
    if (!signedIn() && window.Cloud && Cloud.status.state !== 'off' && !S.settings.hideCloudTip) {
      html += `<div class="notice" style="background:var(--brand-soft);color:var(--brand)">☁️ <div class="grow">Sign in to save your data in the cloud and use it on both phone and website.</div><button class="link" data-act="open" data-kind="cloud">Set up</button><button class="mini-btn" data-act="hide-tip" aria-label="Dismiss">✕</button></div>`;
    } else if (!signedIn() && hasData && (!last || daysBetween(parseDate(last), new Date()) > 30)) {
      html += `<div class="notice">💾 <div class="grow">Your data is stored only on this device. ${last ? 'Last backup ' + fmtDate(last) + '.' : 'You haven\'t backed up yet.'}</div><button class="link" data-act="open" data-kind="backup">Back up</button></div>`;
    }

    const smsN = pendingSms().length;
    if (smsN) html += `<div class="notice" style="background:var(--brand-soft);color:var(--brand)">📩 <div class="grow"><b>${smsN}</b> transaction${smsN > 1 ? 's' : ''} from SMS waiting</div><button class="link" data-act="open" data-kind="inbox">Review</button></div>`;
    html += `<div class="card hero">
      <div class="label">${S.settings.name ? esc(S.settings.name) + '’s ' : ''}Net Worth</div>
      <div class="big amt" style="margin-bottom:${nw.liabilities > 0 ? 2 : 12}px">${esc(fmt(nw.total))}</div>
      ${nw.liabilities > 0 ? `<div class="small amt" style="opacity:.8;margin-bottom:12px">after ${esc(fmt(nw.liabilities))} loans & card dues</div>` : ''}
      <div class="split"><div><small>Total Assets</small><b class="amt">${esc(fmt(nw.assets))}</b></div><div><small>Expenses · ${parseDate(st.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: st.month === iso().slice(0, 7) ? undefined : '2-digit' })}</small><b class="amt">${esc(fmt(exp))}</b></div></div>
    </div>
    <div class="grid3" style="margin-bottom:14px">
      <div class="stat"><small>Accounts</small><b>${money(nw.accAssets)}</b></div>
      <div class="stat" data-tab-go="invest" style="cursor:pointer"><small>FD & PPF</small><b>${money(nw.fd + nw.ppf)}</b></div>
      <div class="stat"><small>Other Assets</small><b>${money(nw.other)}</b></div>
    </div>`;

    const rem = reminders();
    if (rem.length) {
      html += `<div class="section-title" style="margin-top:4px">Upcoming & reminders</div><div class="list">${rem.slice(0, 6).map((r) => `<button class="item" data-act="${r.act}" data-id="${r.id}">
        <div class="avatar ${r.days < 0 ? 'expense' : ''}">${r.icon}</div><div class="grow"><div class="title">${esc(r.title)}</div><div class="sub ellipsis amt">${esc(r.sub)}</div></div>${ICON.chev}</button>`).join('')}</div>`;
    }

    html += monthNav();
    html += `<div class="grid3" style="margin-bottom:14px">
      <div class="stat"><small>Income</small><b>${money(inc, 'pos')}</b></div>
      <div class="stat"><small>Expenses</small><b>${money(exp, 'neg')}</b></div>
      <div class="stat"><small>Saved</small><b>${money(inc - exp, inc - exp >= 0 ? 'pos' : 'neg')}</b></div>
    </div>`;

    html += cashOnlineCard(tx);
    if (S.goals.length) { const gb = balances(); html += `<div class="section-title">Savings goals <button class="link" data-act="goto-goals">See all</button></div><div class="list">${S.goals.slice(0, 3).map((g) => goalItem(g, gb)).join('')}</div>`; }
    const brows = budgetRows(st.month);
    if (brows.length) html += `<div class="card"><h2 class="row"><span class="grow">Budgets</span><button class="link" data-act="open" data-kind="budgets">Manage</button></h2>${brows.slice(0, 5).map((r) => budgetHtml(r)).join('')}</div>`;

    // Expense by category
    const cats = {};
    tx.filter((t) => t.type === 'expense').forEach((t) => { const c = t.category || 'Other'; cats[c] = (cats[c] || 0) + num(t.amount); });
    const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    if (catList.length) {
      html += `<div class="card"><h2>Where the money went</h2>${catList.slice(0, 8).map(([c, v]) => `
        <div class="catrow"><div class="row"><span class="grow ellipsis">${esc(c)}</span><span class="muted small">${Math.round((v / exp) * 100)}%</span>${money(v)}</div>
        <div class="bar"><i style="width:${(v / catList[0][1]) * 100}%"></i></div></div>`).join('')}</div>`;
    }

    // 6-month chart
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(st.month, -i));
    const data = months.map((m) => {
      const t = S.transactions.filter((x) => x.date.slice(0, 7) === m);
      return { m, i: sum(t.filter((x) => x.type === 'income')), e: sum(t.filter((x) => x.type === 'expense')) };
    });
    const max = Math.max(1, ...data.map((d) => Math.max(d.i, d.e)));
    html += `<div class="card"><h2>Last 6 months</h2><div class="chart">${data.map((d) => `
      <div class="col" title="${esc(monthLabel(d.m))}: income ${esc(fmt(d.i))}, expense ${esc(fmt(d.e))}">
        <div class="bars"><i class="in" style="height:${(d.i / max) * 100}%"></i><i class="out" style="height:${(d.e / max) * 100}%"></i></div>
        <span>${parseDate(d.m + '-01').toLocaleDateString('en-IN', { month: 'short' })}</span></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--expense)"></i>Expense</span><span class="grow right amt">max ${esc(compact(max))}</span></div></div>`;


    // Accounts
    const b = balances();
    html += `<div class="section-title">Accounts <button class="link" data-tab-go="accounts">See all</button></div><div class="list">
      ${S.accounts.length ? S.accounts.filter((a) => !a.archived).slice(0, 6).map((a) => accItem(a, b[a.id] || 0)).join('') : '<div class="empty">No accounts yet.</div>'}</div>`;

    // Recent
    const recent = [...S.transactions].sort((a, b) => (b.date + (b.created || '')).localeCompare(a.date + (a.created || ''))).slice(0, 5);
    html += `<div class="section-title">Recent entries <button class="link" data-tab-go="txns">See all</button></div>`;
    html += recent.length ? `<div class="list">${recent.map((t) => txnRow(t)).join('')}</div>` : groupedTxns([]);
    return html;
  }

  function viewTxns() {
    const f = st.filter;
    let list = S.transactions.filter((t) => t.date.slice(0, 7) === st.month);
    if (f.account) list = list.filter((t) => t.accountId === f.account || t.toAccountId === f.account);
    if (f.type) list = list.filter((t) => t.type === f.type);
    if (f.mode) list = list.filter((t) => { const m = modeOf(t); return f.mode === 'online' ? (m && m !== 'cash') : m === f.mode; });
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((t) => [t.category, t.note, accName(t.accountId), String(t.amount), MODE_LABEL[t.mode] || ''].join(' ').toLowerCase().includes(q)); }
    const inc = sum(list.filter((t) => t.type === 'income')), exp = sum(list.filter((t) => t.type === 'expense'));
    return monthNav() + `
      <div class="filters">
        <select data-filter="account"><option value="">All accounts</option>${S.accounts.map((a) => `<option value="${a.id}" ${f.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <select data-filter="type"><option value="">All types</option>${['income', 'expense', 'transfer'].map((x) => `<option value="${x}" ${f.type === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>
        <select data-filter="mode"><option value="">Cash & online</option>${[['cash', 'Cash only'], ['online', 'All online'], ['upi', 'UPI'], ['card', 'Card'], ['bank', 'Net Banking']].map(([k, l]) => `<option value="${k}" ${f.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="search" data-filter="q" placeholder="Search category, note, amount…" value="${esc(f.q)}">
      </div>
      <div class="grid3" style="margin-bottom:14px">
        <div class="stat"><small>In</small><b>${money(inc, 'pos')}</b></div>
        <div class="stat"><small>Out</small><b>${money(exp, 'neg')}</b></div>
        <div class="stat"><small>Entries</small><b>${list.length}</b></div>
      </div>` + groupedTxns(list);
  }

  function accItem(a, bal) {
    const t = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.other;
    let sub = [a.bankName, a.accountNumber ? mask(a.accountNumber) : '', a.type === 'credit' && a.cardLast4 ? '•••• ' + a.cardLast4 : ''].filter(Boolean).join(' · ') || t.label;
    if (a.type === 'credit') { const c = cardCycle(a); if (c && c.remaining > 0) sub = `Pay ${fmt(c.remaining)}${c.dueISO ? ' by ' + fmtDate(c.dueISO).replace(/ \d{4}$/, '') : ''} · ` + sub; }
    return `<button class="item" data-act="open-account" data-id="${a.id}">
      <div class="avatar">${accIcon(a)}</div>
      <div class="grow"><div class="title ellipsis">${esc(a.name)}</div><div class="sub ellipsis">${esc(sub)}</div></div>
      <div class="right"><b>${money(bal, bal < 0 ? 'neg' : '')}</b></div>${ICON.chev}</button>`;
  }

  function viewAccounts() {
    const b = balances();
    const active = S.accounts.filter((a) => !a.archived);
    const total = active.filter((a) => a.includeNW !== false).reduce((s, a) => s + (b[a.id] || 0), 0);
    let html = `<div class="card"><div class="row"><div class="grow"><div class="muted small">Total balance (all accounts)</div><div style="font-size:26px;font-weight:800">${money(total, total < 0 ? 'neg' : '')}</div></div>
      <button class="btn primary" data-act="add-account">+ Account</button></div></div>`;
    for (const [type, meta] of Object.entries(ACCOUNT_TYPES)) {
      const list = active.filter((a) => (a.type || 'other') === type);
      if (!list.length) continue;
      const sub = list.reduce((s, a) => s + (b[a.id] || 0), 0);
      html += `<div class="section-title"><span>${meta.label}</span><span class="amt">${esc(fmt(sub))}</span></div>
        <div class="list">${list.map((a) => accItem(a, b[a.id] || 0)).join('')}</div>`;
    }
    const archived = S.accounts.filter((a) => a.archived);
    if (archived.length) html += `<div class="section-title">Archived</div><div class="list">${archived.map((a) => accItem(a, b[a.id] || 0)).join('')}</div>`;
    if (!S.accounts.length) html += `<div class="list"><div class="empty"><div class="em">🏦</div>Add your bank accounts, cash, wallets and credit cards.</div></div>`;
    return html;
  }

  function kv(label, value, opts = {}) {
    if (!value && value !== 0) return '';
    const copy = opts.copy ? `<button class="mini-btn" data-act="copy" data-text="${esc(opts.copy)}">Copy</button>` : '';
    const rev = opts.reveal ? `<button class="mini-btn" data-act="reveal" data-key="${esc(opts.reveal)}">${st.reveal[opts.reveal] ? 'Hide' : 'Show'}</button>` : '';
    return `<div class="kv"><span>${esc(label)}</span><span class="val">${opts.html ? value : esc(value)}${rev}${copy}</span></div>`;
  }

  function viewAccount(id) {
    const a = S.accounts.find((x) => x.id === id);
    if (!a) { st.sub = null; return viewAccounts(); }
    const bal = balances()[a.id] || 0;
    const list = S.transactions.filter((t) => t.accountId === id || t.toAccountId === id);
    const inc = sum(list.filter((t) => t.type === 'income' || (t.type === 'transfer' && t.toAccountId === id)));
    const out = sum(list.filter((t) => t.type === 'expense' || (t.type === 'transfer' && t.accountId === id)));
    const revKey = 'acc' + a.id;
    const accNo = a.accountNumber ? (st.reveal[revKey] ? a.accountNumber : mask(a.accountNumber)) : '';
    const details = [
      kv('Type', (ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.other).label + (a.subtype ? ' · ' + a.subtype : '')),
      kv('Bank / Provider', a.bankName),
      kv('Account holder', a.holder),
      kv('Account number', accNo, { reveal: a.accountNumber ? revKey : null, copy: a.accountNumber }),
      kv('IFSC', a.ifsc, { copy: a.ifsc }),
      kv('Branch', a.branch),
      kv('UPI ID', a.upi, { copy: a.upi }),
      kv('Nominee', a.nominee),
      kv('Card', a.cardLast4 ? '•••• ' + a.cardLast4 : ''),
      kv('Credit limit', a.creditLimit ? money(a.creditLimit) : '', { html: true }),
      kv('Available credit', a.type === 'credit' && a.creditLimit ? money(num(a.creditLimit) + bal) : '', { html: true }),
      kv('Statement day', a.statementDay ? 'Day ' + a.statementDay + ' of month' : ''),
      kv('Payment due day', a.dueDay ? 'Day ' + a.dueDay + ' of month' : ''),
      kv('Opening balance', money(a.openingBalance || 0), { html: true }),
      kv('Notes', a.notes),
    ].join('');
    return `<div class="card hero"><div class="row"><div class="avatar" style="background:rgba(255,255,255,.15)">${accIcon(a)}</div><div class="grow"><div class="label">${esc(a.name)}</div></div></div>
      <div class="big amt">${esc(fmt(bal))}</div>
      <div class="split"><div><small>Money in</small><b class="amt">${esc(fmt(inc))}</b></div><div><small>Money out</small><b class="amt">${esc(fmt(out))}</b></div></div></div>
      <div class="btn-row" style="margin-bottom:14px"><button class="btn" data-act="add-txn" data-account="${a.id}">+ Entry</button><button class="btn" data-act="edit-account" data-id="${a.id}">Edit details</button></div>
      ${a.type === 'credit' ? cardCycleCard(a, bal) : ''}
      <div class="card"><h2>Details</h2>${details}</div>
      <div class="section-title">Entries (${list.length})</div>${groupedTxns(list, false)}`;
  }

  function fdItem(f, c) {
    const status = f.status === 'closed' ? '<span class="badge">Closed</span>'
      : c.daysLeft <= 0 ? '<span class="badge warn">Matured</span>'
        : c.daysLeft <= 45 ? `<span class="badge warn">${c.daysLeft}d left</span>` : `<span class="badge ok">Active</span>`;
    return `<button class="item" data-act="edit-fd" data-id="${f.id}" style="flex-wrap:wrap">
      <div class="avatar">🔒</div>
      <div class="grow"><div class="title ellipsis">${esc(f.bank)} ${status}</div>
        <div class="sub">${money(f.principal)} @ ${num(f.rate)}% · matures ${fmtDate(c.matISO)}</div></div>
      <div class="right"><b>${money(f.payout && f.payout !== 'cumulative' ? c.payoutAmt : c.maturity)}</b><div class="sub">${f.payout && f.payout !== 'cumulative' ? f.payout + ' payout' : 'at maturity'}</div></div>
      <div class="bar" style="flex-basis:100%;margin-left:52px;height:5px"><i style="width:${Math.round(c.progress * 100)}%"></i></div></button>`;
  }

  function viewFds() {
    const active = S.fds.filter((f) => f.status !== 'closed');
    const calc = active.map((f) => fdCalc(f));
    const principal = active.reduce((s, f) => s + num(f.principal), 0);
    const current = calc.reduce((s, c) => s + c.current, 0);
    const maturity = calc.reduce((s, c) => s + c.maturity, 0);
    const interest = calc.reduce((s, c) => s + c.interest, 0);
    const list = S.fds.filter((f) => (st.fdTab === 'closed' ? f.status === 'closed' : f.status !== 'closed'))
      .map((f) => ({ f, c: fdCalc(f) })).sort((a, b) => a.c.matISO.localeCompare(b.c.matISO));
    return `<div class="card hero"><div class="label">Fixed Deposits — current value</div><div class="big amt">${esc(fmt(current))}</div>
      <div class="split"><div><small>Invested</small><b class="amt">${esc(fmt(principal))}</b></div><div><small>Total interest (at maturity)</small><b class="amt">${esc(fmt(interest))}</b></div></div></div>
      <div class="grid2" style="margin-bottom:14px"><div class="stat"><small>Active FDs</small><b>${active.length}</b></div><div class="stat"><small>Value at maturity</small><b>${money(maturity)}</b></div></div>
      <div class="row" style="margin-bottom:12px"><div class="tabs grow" style="margin:0">
        <button class="${st.fdTab === 'active' ? 'on' : ''}" data-act="fd-tab" data-v="active">Active</button>
        <button class="${st.fdTab === 'closed' ? 'on' : ''}" data-act="fd-tab" data-v="closed">Closed</button></div>
        <button class="btn primary" data-act="add-fd">+ FD</button></div>
      ${list.length ? `<div class="list">${list.map(({ f, c }) => fdItem(f, c)).join('')}</div>`
        : `<div class="list"><div class="empty"><div class="em">🔒</div>${st.fdTab === 'closed' ? 'No closed FDs.' : 'Add your fixed deposits to track interest and maturity dates.'}</div></div>`}`;
  }

  function viewMore() {
    const cs = window.Cloud ? Cloud.status : { state: 'off' };
    const cloudSub = signedIn() ? 'Signed in as ' + Cloud.user.email : cs.state === 'unconfigured' ? 'Not set up yet' : 'Sign in to sync phone & website';
    const dueBills = S.bills.filter((b) => b.active && b.nextDue && daysBetween(today0(), parseDate(b.nextDue)) <= 7).length;
    const sections = [
      ['Everyday', [
        ['bills', '🧾', 'Bills & subscriptions', dueBills ? `${dueBills} due this week` : `${S.bills.length} bill${S.bills.length === 1 ? '' : 's'} · electricity, mobile, OTT…`],
        ['sms', '📩', 'SMS auto-add', S.settings.inboxToken ? 'On · review bank SMS' : 'Turn bank SMS into entries'],
        ['recurring', '🔁', 'Recurring entries', `${S.recurring.length} rule${S.recurring.length === 1 ? '' : 's'} · salary, rent, SIP…`],
        ['budgets', '🎯', 'Budgets', 'Monthly spending limits'],
      ]],
      ['Life', [
        ['vehicles', '🚗', 'Vehicles', S.vehicles.length ? S.vehicles.map((v) => v.name).join(', ') : 'Fuel, mileage, service, PUC'],
        ['warranties', '📦', 'Warranties', `${S.warranties.length} product${S.warranties.length === 1 ? '' : 's'} · bills & end dates`],
        ['emergency', '🆘', 'Family emergency sheet', 'One PDF with everything your family needs'],
      ]],
      ['App', [
        ['cloud', '☁️', 'Cloud Sync & Login', cloudSub],
        ['categories', '🏷️', 'Categories', 'Edit income & expense categories'],
        ['backup', '💾', 'Backup & Restore', 'Export / import your data, CSV export'],
        ['settings', '⚙️', 'Settings & App lock', pinData() ? 'PIN lock is on' : 'Name, currency, PIN lock'],
      ]],
    ];
    return sections.map(([title, items]) => `<div class="section-title">${title}</div><div class="list">${items.map(([k, i, t, sub]) => `<button class="item" data-act="open" data-kind="${k}"><div class="avatar">${i}</div><div class="grow"><div class="title">${t}</div><div class="sub ellipsis">${esc(sub)}</div></div>${ICON.chev}</button>`).join('')}</div>`).join('')
      + `<p class="muted small" style="text-align:center">Account Manager v1.6 · works offline${signedIn() ? ' · synced to your cloud account' : ' · data stored on this device'}</p>`;
  }

  function viewAssets() {
    const assets = S.assets.filter((x) => x.kind !== 'liability');
    const liabs = S.assets.filter((x) => x.kind === 'liability');
    const ta = assets.reduce((s, x) => s + num(x.value), 0), tl = liabs.reduce((s, x) => s + num(x.value), 0);
    const item = (x) => `<button class="item" data-act="edit-asset" data-id="${x.id}"><div class="avatar">${x.kind === 'liability' ? '📉' : '📈'}</div>
      <div class="grow"><div class="title ellipsis">${esc(x.name)}</div><div class="sub ellipsis">${esc(x.category || '')}${x.asOf ? ' · as of ' + fmtDate(x.asOf) : ''}</div></div>
      <div class="right"><b>${money(x.value, x.kind === 'liability' ? 'neg' : '')}</b></div></button>`;
    return `<p class="muted small" style="margin-top:0">Add things you own (gold, property, stocks, mutual funds, PPF/EPF) and what you owe (loans). These count toward your net worth.</p>
      <div class="grid2" style="margin-bottom:14px"><div class="stat"><small>Assets</small><b>${money(ta, 'pos')}</b></div><div class="stat"><small>Liabilities</small><b>${money(tl, 'neg')}</b></div></div>
      <div class="btn-row" style="margin-bottom:6px"><button class="btn" data-act="add-asset" data-kind="asset">+ Asset</button><button class="btn" data-act="add-asset" data-kind="liability">+ Liability / Loan</button></div>
      <div class="section-title">Assets</div><div class="list">${assets.length ? assets.map(item).join('') : '<div class="empty">No assets added.</div>'}</div>
      <div class="section-title">Liabilities</div><div class="list">${liabs.length ? liabs.map(item).join('') : '<div class="empty">No liabilities added.</div>'}</div>`;
  }

  function viewCategories() {
    const block = (kind) => `<div class="card"><h2>${kind === 'income' ? 'Income' : 'Expense'} categories</h2>
      <div class="chips" style="margin-bottom:12px">${S.categories[kind].map((c) => `<span class="chip">${esc(c)}<button data-act="cat-del" data-kind="${kind}" data-name="${esc(c)}" aria-label="Remove">×</button></span>`).join('')}</div>
      <div class="row"><input class="grow" id="newcat-${kind}" placeholder="New category" style="padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--card)"><button class="btn" data-act="cat-add" data-kind="${kind}">Add</button></div></div>`;
    return block('expense') + block('income');
  }

  function viewBackup() {
    const bytes = new Blob([JSON.stringify(S)]).size;
    return `<div class="card"><h2>Backup</h2>
      <p class="small muted" style="margin-top:0">Everything is stored only on this device. Export a backup regularly and keep it safe (Google Drive, email to yourself…). You can import it on another phone or the website.</p>
      <div class="kv"><span>Last backup</span><span class="val">${S.settings.lastBackup ? fmtDate(S.settings.lastBackup) : 'Never'}</span></div>
      <div class="kv"><span>Data size</span><span class="val">${(bytes / 1024).toFixed(1)} KB</span></div>
      <div class="kv"><span>Entries / Accounts / FDs</span><span class="val">${S.transactions.length} / ${S.accounts.length} / ${S.fds.length}</span></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="export-json">Export backup (.json)</button></div>
      ${S.documents.length ? `<p class="small muted">Note: uploaded document files are not inside this backup file (only their list). ${signedIn() ? 'They are safe in your cloud account.' : 'Sign in to Cloud Sync to keep them safe.'}</p>` : ''}</div>
      <div class="card"><h2>Restore</h2><p class="small muted" style="margin-top:0">Importing a backup <b>replaces</b> all data currently in the app.</p>
      <button class="btn block" data-act="import-json">Import backup file</button></div>
      <div class="card"><h2>Spreadsheet</h2><p class="small muted" style="margin-top:0">Export all entries as CSV to open in Excel / Google Sheets.</p>
      <button class="btn block" data-act="export-csv">Export entries (.csv)</button></div>`;
  }

  function syncText() {
    if (!window.Cloud) return ['off', 'Cloud sync unavailable'];
    const c = Cloud.status;
    if (!signedIn()) return ['off', 'Not signed in'];
    if (c.error) return ['err', c.error];
    if (!navigator.onLine) return ['wait', c.pending ? 'Offline — changes saved on this device, will upload when online' : 'Offline — showing saved data'];
    if (c.state === 'syncing') return ['wait', 'Connecting…'];
    if (c.pending) return ['wait', 'Uploading changes…'];
    return ['ok', 'All changes saved to the cloud'];
  }

  function viewCloud() {
    const c = window.Cloud ? Cloud.status : { state: 'off' };
    if (c.state === 'off') return `<div class="card"><p>Cloud sync could not load on this device.</p></div>`;
    if (c.state === 'unconfigured') {
      return `<div class="card"><h2>Connect your cloud database</h2>
        <p class="small muted" style="margin-top:0">Cloud sync uses your own free <b>Firebase</b> project, so only you own the data. Paste the <b>web app config</b> from Firebase console → Project settings → Your apps. (Setup steps are in the README.) You only need to do this once per device, or ask for it to be built into the app.</p>
        ${c.error ? `<div class="notice">${esc(c.error)}</div>` : ''}
        <div class="field"><textarea id="cfg-text" rows="8" placeholder='const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…"\n};' style="font-family:monospace;font-size:13px"></textarea></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="cfg-save">Save & connect</button></div></div>`;
    }
    if (!signedIn()) {
      return `<div class="card"><h2>Sign in</h2>
        <p class="small" style="margin-top:0"><b>First time?</b> Enter your email and a new password, then tap <b>Create account</b>. After that, use <b>Sign in</b> on every device.</p>
        <p class="small muted">Use the same email & password on your phone and on the website — your accounts, entries and FDs will be the same everywhere. The app keeps working offline and syncs when you are back online.</p>
        <div class="form">
          <div class="field"><label>Email</label><input id="cl-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
          <div class="field"><label>Password</label><input id="cl-pass" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="At least 6 characters">
          <label class="small muted" style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" onclick="document.getElementById('cl-pass').type=this.checked?'text':'password'" style="width:auto"> Show password</label></div>
          <div class="form-actions"><button class="btn primary" data-act="cl-signin">Sign in</button><button class="btn" data-act="cl-signup">Create account</button></div>
          <div class="field"><button class="link" data-act="cl-reset" style="align-self:flex-start">Forgot password?</button></div>
        </div></div>
        <p class="small muted">On first sign-in, data already on this device is uploaded to your account (or merged, if the account already has data).</p>
        ${Cloud.configSource === 'device' ? `<button class="link small" data-act="cfg-clear">Change Firebase project (${esc(Cloud.projectId)})</button>` : ''}`;
    }
    const [k, txt] = syncText();
    return `<div class="card"><h2>Cloud account</h2>
      <div class="kv"><span>Signed in as</span><span class="val">${esc(Cloud.user.email)}</span></div>
      <div class="kv"><span>Sync status</span><span class="val"><span class="badge ${k === 'ok' ? 'ok' : k === 'err' ? '' : 'warn'}" id="syncStatusText">${esc(txt)}</span></span></div>
      <div class="kv"><span>Accounts / Entries / FDs / Assets</span><span class="val">${S.accounts.length} / ${S.transactions.length} / ${S.fds.length} / ${S.assets.length}</span></div>
      <div class="kv"><span>Cloud project</span><span class="val">${esc(Cloud.projectId)}</span></div></div>
      <div class="card"><p class="small muted" style="margin-top:0">Every change is saved on this device first and uploaded automatically. Open the website or the app on another phone and sign in with the same email to see the same data.</p>
      <button class="btn block" data-act="cl-signout">Sign out</button>
      <p class="small muted">Signing out removes the data from this device only. It stays safe in your cloud account.</p></div>`;
  }

  function viewSettings() {
    return `<div class="card"><h2>Profile</h2><div class="form">
      <div class="field"><label>Your name</label><input id="set-name" value="${esc(S.settings.name)}" placeholder="Shown on the home screen"></div>
      <div class="field"><label>Currency</label><select id="set-cur">${CURRENCIES.map((c) => `<option ${S.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="form-actions"><button class="btn primary" data-act="save-settings">Save</button></div></div></div>
      <div class="card"><h2>App lock</h2>
        <p class="small muted" style="margin-top:0">Ask for a 4-digit PIN when the app is opened. Recommended — your documents and account numbers are inside. The PIN is set separately on each device.</p>
        ${pinData() ? `<div class="btn-row"><button class="btn" data-act="pin" data-mode="change">Change PIN</button><button class="btn danger" data-act="pin" data-mode="remove">Remove PIN</button></div>`
          : `<button class="btn primary block" data-act="pin" data-mode="set">Set PIN</button>`}</div>
      <div class="card"><h2>Try it out</h2><p class="small muted" style="margin-top:0">Load sample accounts, entries and FDs to explore the app. Erase them afterwards with “Erase all data”.</p>
      <button class="btn block" data-act="demo">Load sample data</button></div>
      <div class="card"><h2>Danger zone</h2><button class="btn block danger" data-act="reset">Erase all data</button></div>`;
  }

  const SUBS = {
    account: { title: () => 'Account', view: (s) => viewAccount(s.id), fab: true },
    cloud: { title: () => 'Cloud Sync', view: viewCloud },
    ppf: { title: () => 'PPF Account', view: (s) => viewPpfDetail(s.id), fab: true },
    recurring: { title: () => 'Recurring entries', view: viewRecurring },
    policy: { title: () => 'Insurance policy', view: (x) => viewPolicy(x.id) },
    goal: { title: () => 'Savings goal', view: (x) => viewGoal(x.id) },
    emergency: { title: () => 'Emergency sheet', view: viewEmergency },
    sms: { title: () => 'SMS auto-add', view: viewSmsSetup },
    bills: { title: () => 'Bills', view: viewBills },
    warranties: { title: () => 'Warranties', view: viewWarranties },
    vehicles: { title: () => 'Vehicles', view: viewVehicles },
    vehicle: { title: () => 'Vehicle', view: (x) => viewVehicle(x.id), fab: true },
    search: { title: () => 'Search', view: viewSearch },
    inbox: { title: () => 'SMS inbox', view: viewInbox },
    budgets: { title: () => 'Budgets', view: viewBudgets },
    assets: { title: () => 'Assets & Liabilities', view: viewAssets },
    categories: { title: () => 'Categories', view: viewCategories },
    backup: { title: () => 'Backup & Restore', view: viewBackup },
    settings: { title: () => 'Settings', view: viewSettings },
  };
  const TABS = { home: ['Home', viewHome], txns: ['Entries', viewTxns], accounts: ['Accounts', viewAccounts], invest: ['Wealth', viewInvest], docs: ['Documents', viewDocs], more: ['More', viewMore] };

  function render() {
    let title, html;
    if (st.sub && SUBS[st.sub.kind]) {
      const s = SUBS[st.sub.kind];
      title = s.title(st.sub); html = s.view(st.sub);
      document.body.classList.add('sub');
      document.body.classList.toggle('show-fab', !!s.fab);
    } else {
      st.sub = null;
      [title, html] = [TABS[st.tab][0], TABS[st.tab][1]()];
      document.body.classList.remove('sub', 'show-fab');
    }
    // A sub view might have reset itself (e.g. deleted account)
    if (!st.sub) document.body.classList.remove('sub', 'show-fab');
    $('#title').textContent = title;
    $('#backBtn').hidden = !st.sub;
    $('#view').innerHTML = html;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === st.tab && !st.sub));
    updateSyncBadge();
  }

  function updateSyncBadge() {
    const el = $('#syncBtn'); if (!el) return;
    const [k, txt] = syncText();
    el.hidden = !window.Cloud || Cloud.status.state === 'off';
    el.dataset.state = k; el.title = txt; el.setAttribute('aria-label', 'Cloud sync: ' + txt);
    const s = $('#syncStatusText');
    if (s) { s.textContent = txt; s.className = 'badge ' + (k === 'ok' ? 'ok' : k === 'err' ? '' : 'warn'); }
  }
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return; renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const a = document.activeElement;
      // Don't wipe what the user is typing in an input on the page (modals are separate and safe).
      if (a && $('#view').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { updateSyncBadge(); return; }
      render();
    });
  }

  // ---------- Modal + forms ----------
  let closeTop = null;
  function modal(title) {
    const root = $('#modalRoot');
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div><div class="sheet-body"></div></div>`;
    root.appendChild(ov);
    const close = () => { ov.remove(); closeTop = root.lastElementChild ? closeTop : null; };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    $('.sheet-head .icon-btn', ov).onclick = close;
    closeTop = close;
    return { body: $('.sheet-body', ov), close };
  }

  function fieldHtml(f, v) {
    const val = v[f.name] ?? '';
    const cls = `field${f.half ? ' half' : ''}${f.big ? ' big' : ''}${f.type === 'checkbox' ? ' check' : ''}`;
    const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
    const req = f.required ? 'required' : '';
    const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
    switch (f.type) {
      case 'segment':
        return `<div class="field">${f.label ? `<label>${esc(f.label)}</label>` : ''}<div class="segment ${f.options.length > 3 ? 'small' : ''}">${f.options.map(([o, l]) => `<button type="button" data-seg="${f.name}" data-v="${o}" class="${o} ${val === o ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
      case 'select':
        return `<div class="${cls}"><label>${esc(f.label)}</label><select name="${f.name}" ${req}>${f.options.map(([o, l]) => `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${help}</div>`;
      case 'textarea':
        return `<div class="${cls}"><label>${esc(f.label)}</label><textarea name="${f.name}" ${ph}>${esc(val)}</textarea>${help}</div>`;
      case 'checkbox':
        return `<div class="${cls}"><input type="checkbox" id="f-${f.name}" name="${f.name}" ${val ? 'checked' : ''}><label for="f-${f.name}">${esc(f.label)}</label></div>`;
      case 'preview':
        return `<div class="preview" data-preview="${f.name}">${f.render(v)}</div>`;
      case 'file':
        return `<div class="${cls}"><label>${esc(f.label)}</label><input type="file" name="${f.name}" ${f.multiple ? 'multiple' : ''} ${f.accept ? `accept="${f.accept}"` : ''} ${f.capture ? `capture="${f.capture}"` : ''}>${help}</div>`;
      case 'list': {
        const id = 'dl-' + f.name;
        return `<div class="${cls}"><label>${esc(f.label)}</label><input name="${f.name}" list="${id}" value="${esc(val)}" ${ph} ${req} autocomplete="off"><datalist id="${id}">${f.options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>${help}</div>`;
      }
      default: {
        const t = f.type || 'text';
        const extra = t === 'number' ? `inputmode="decimal" step="${f.step || 'any'}"` : f.inputmode ? `inputmode="${f.inputmode}"` : '';
        return `<div class="${cls}"><label>${esc(f.label)}</label><input type="${t}" name="${f.name}" value="${esc(val)}" ${extra} ${ph} ${req} ${f.max ? `maxlength="${f.max}"` : ''}>${help}</div>`;
      }
    }
  }

  /** cfg: {title, values, fields(vals) => [], onSave(vals, again) => true|string(error), onDelete, saveAgain, extra:[{label, act(vals)}]} */
  function openForm(cfg) {
    const m = modal(cfg.title);
    let vals = { ...cfg.values };
    const collect = (form) => {
      form.querySelectorAll('[name]').forEach((el) => { vals[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'file' ? [...el.files] : el.value; });
    };
    function draw() {
      const fields = cfg.fields(vals);
      m.body.innerHTML = `<form class="form" novalidate>${fields.map((f) => fieldHtml(f, vals)).join('')}
        <div class="form-actions">${cfg.onDelete ? '<button type="button" class="btn danger" data-fa="delete">Delete</button>' : ''}
        ${(cfg.extra || []).map((x, i) => `<button type="button" class="btn" data-fa="x${i}">${esc(x.label)}</button>`).join('')}
        ${cfg.saveAgain ? '<button type="button" class="btn" data-fa="again">Save & add another</button>' : ''}
        <button type="submit" class="btn primary">Save</button></div></form>`;
      const form = $('form', m.body);
      form.querySelectorAll('input[type=file]').forEach((el) => {
        const f = vals[el.name];
        if (Array.isArray(f) && f.length) { try { const dt = new DataTransfer(); f.forEach((x) => dt.items.add(x)); el.files = dt.files; } catch {} }
      });
      const autofocus = form.querySelector('[data-autofocus], .big input');
      if (autofocus && !cfg._drawn && !('ontouchstart' in window)) autofocus.focus();
      cfg._drawn = true;
      form.addEventListener('input', () => {
        collect(form);
        fields.filter((f) => f.type === 'preview').forEach((f) => { const el = form.querySelector(`[data-preview="${f.name}"]`); if (el) el.innerHTML = f.render(vals); });
      });
      form.addEventListener('change', (e) => {
        collect(form);
        const f = fields.find((x) => x.name === e.target.name);
        if (f && f.rerender) draw();
      });
      form.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => { collect(form); vals[b.dataset.seg] = b.dataset.v; vals['_touched_' + b.dataset.seg] = true; draw(); }));
      const submit = (again) => {
        collect(form);
        const res = cfg.onSave(vals, again);
        if (res === true) { m.close(); render(); if (again) cfg.reopen && cfg.reopen(vals); }
        else if (typeof res === 'string') toast(res);
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
      form.querySelectorAll('[data-fa]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.fa;
        if (a === 'again') submit(true);
        else if (a === 'delete') { if (cfg.onDelete()) { m.close(); render(); } }
        else { collect(form); const x = cfg.extra[+a.slice(1)]; if (x.act(vals)) { m.close(); render(); } }
      }));
    }
    draw();
  }

  // ---------- Forms ----------
  function txnForm(t, preset = {}) {
    const isNew = !t;
    const firstAcc = (S.accounts.find((a) => !a.archived) || {}).id || '';
    const values = t ? { ...t, _touched_mode: !!t.mode } : { type: preset.type || 'expense', amount: preset.amount || '', accountId: preset.accountId || firstAcc, toAccountId: preset.toAccountId || '', category: preset.category || '', date: preset.date || iso(), note: preset.note || '', repeat: '', mode: preset.mode || '', _touched_mode: !!preset.mode };
    if (!S.accounts.length) { toast('Add an account first'); return; }
    const accOpts = S.accounts.filter((a) => !a.archived || (t && (a.id === t.accountId || a.id === t.toAccountId))).map((a) => [a.id, `${accIcon(a)} ${a.name}`]);
    openForm({
      title: isNew ? 'New entry' : 'Edit entry',
      values,
      saveAgain: isNew,
      reopen: (v) => txnForm(null, { type: v.type, accountId: v.accountId, date: v.date }),
      fields: (v) => {
        const f = [
          { name: 'type', type: 'segment', options: [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']] },
          { name: 'amount', label: 'Amount', type: 'number', big: true, required: true, placeholder: '0' },
          { name: 'accountId', label: v.type === 'transfer' ? 'From account' : 'Account', type: 'select', options: accOpts, half: v.type === 'transfer', rerender: true },
        ];
        if (v.type !== 'transfer') {
          if (!v._touched_mode) v.mode = defMode(v.accountId);
          f.push({ name: 'mode', label: v.type === 'expense' ? 'Paid by' : 'Received via', type: 'segment', options: PAY_MODES, labelled: true });
        }
        if (v.type === 'transfer') f.push({ name: 'toAccountId', label: 'To account', type: 'select', options: [['', '— select —'], ...accOpts], half: true });
        else f.push({ name: 'category', label: 'Category', type: 'list', options: S.categories[v.type] || [], placeholder: 'Pick or type a new one' });
        f.push({ name: 'date', label: 'Date', type: 'date', required: true });
        f.push({ name: 'note', label: 'Note', placeholder: 'Optional' });
        if (!v.repeat) f.push({ name: 'receipt', label: t && t.receiptId ? 'Replace receipt / bill photo' : 'Receipt / bill photo (optional)', type: 'file', accept: 'image/*,application/pdf' });
        if (isNew && !preset.noRepeat) f.push({ name: 'repeat', label: 'Repeat', type: 'select', options: [['', 'Does not repeat'], ...FREQ], help: v.repeat ? 'Added automatically on this date every period. Manage in More → Recurring entries.' : '' , rerender: true });
        return f;
      },
      onSave: (v) => {
        const amount = num(v.amount);
        if (!(amount > 0)) return 'Enter an amount greater than 0';
        if (!v.accountId) return 'Choose an account';
        if (!v.date) return 'Choose a date';
        if (v.type === 'transfer') {
          if (!v.toAccountId) return 'Choose the account to transfer to';
          if (v.toAccountId === v.accountId) return 'From and To accounts must differ';
        }
        const cat = v.type === 'transfer' ? '' : (v.category || '').trim() || 'Other';
        if (cat && !S.categories[v.type].includes(cat)) S.categories[v.type].push(cat);
        const mode = v.type === 'transfer' ? '' : (v.mode || '');
        if (isNew && v.repeat) {
          const r = { id: uid(), type: v.type, amount, accountId: v.accountId, toAccountId: v.type === 'transfer' ? v.toAccountId : '', category: cat, mode, note: (v.note || '').trim(), freq: v.repeat, startDate: v.date, endDate: '', lastRun: '', active: true };
          S.recurring.push(r);
          if (!runRecurring()) { save(); toast(`Recurring entry set — first one on ${fmtDate(v.date)}`); }
          return true;
        }
        const rec = { id: t ? t.id : uid(), type: v.type, amount, accountId: v.accountId, toAccountId: v.type === 'transfer' ? v.toAccountId : '', category: cat, mode, date: v.date, note: (v.note || '').trim(), created: t ? t.created : new Date().toISOString() };
        if (t) ['recurringId', 'receiptId', 'policyId', 'fromSms', 'billId', 'vehicleId'].forEach((k) => { if (t[k]) rec[k] = t[k]; });
        if (t) Object.assign(t, rec); else S.transactions.push(rec);
        save(); toast(t ? 'Entry updated' : 'Entry saved');
        if (preset.onSaved) preset.onSaved(rec);
        if (v.receipt && v.receipt.length) {
          addDocuments(v.receipt.slice(0, 1), { name: `Receipt: ${cat || 'Transfer'} ${fmtDate(v.date)}`, category: 'Bills & Receipts', compress: true, txnId: rec.id, quiet: true }).then((ids) => {
            const tx = S.transactions.find((x) => x.id === rec.id);
            if (!tx || !ids[0]) return;
            const old = tx.receiptId && S.documents.find((d) => d.id === tx.receiptId);
            if (old) deleteDocument(old);
            tx.receiptId = ids[0]; save(); render(); toast('Receipt attached');
          }).catch((e) => alert('Could not save receipt: ' + e.message));
        }
        return true;
      },
      extra: t && t.receiptId && S.documents.some((d) => d.id === t.receiptId) ? [{ label: '📎 View receipt', act: () => { openDocument(S.documents.find((d) => d.id === t.receiptId)); return false; } }] : [],
      onDelete: t ? () => {
        if (!confirm('Delete this entry?' + (t.receiptId ? ' Its receipt will be deleted too.' : ''))) return false;
        const rd = t.receiptId && S.documents.find((d) => d.id === t.receiptId);
        if (rd) deleteDocument(rd);
        S.transactions = S.transactions.filter((x) => x.id !== t.id); save(); toast('Entry deleted'); return true;
      } : null,
    });
  }

  function accountForm(a) {
    openForm({
      title: a ? 'Edit account' : 'New account',
      values: a ? { ...a } : { type: 'bank', name: '', openingBalance: '', includeNW: true },
      fields: (v) => {
        const f = [
          { name: 'type', label: 'Account type', type: 'select', options: Object.entries(ACCOUNT_TYPES).map(([k, m]) => [k, `${m.icon} ${m.label}`]), rerender: true },
          { name: 'name', label: 'Account name', required: true, placeholder: v.type === 'bank' ? 'e.g. SBI Savings' : v.type === 'credit' ? 'e.g. HDFC Millennia' : 'e.g. Wallet' },
          { name: 'openingBalance', label: v.type === 'credit' ? 'Current outstanding (enter as negative, e.g. -5000)' : 'Current / opening balance', type: 'number', placeholder: '0',
            help: v.type === 'credit' ? 'Spending on this card will increase what you owe.' : 'Balance today. Entries you add will adjust it.' },
        ];
        if (v.type === 'bank') {
          f.push(
            { name: 'bankName', label: 'Bank name', half: true, placeholder: 'e.g. SBI' },
            { name: 'subtype', label: 'Account kind', type: 'select', half: true, options: [['', '—'], ['Savings', 'Savings'], ['Current', 'Current'], ['Salary', 'Salary'], ['NRE', 'NRE'], ['NRO', 'NRO'], ['Joint', 'Joint']] },
            { name: 'holder', label: 'Account holder name' },
            { name: 'accountNumber', label: 'Account number', type: 'text', placeholder: 'Stored only on this device' },
            { name: 'ifsc', label: 'IFSC code', half: true },
            { name: 'branch', label: 'Branch', half: true },
            { name: 'upi', label: 'UPI ID', placeholder: 'name@bank' },
            { name: 'nominee', label: 'Nominee' },
          );
        } else if (v.type === 'credit') {
          f.push(
            { name: 'bankName', label: 'Issuing bank', half: true },
            { name: 'cardLast4', label: 'Card last 4 digits', half: true, max: 4, help: 'Never store the full card number.' },
            { name: 'creditLimit', label: 'Credit limit', type: 'number', half: true },
            { name: 'statementDay', label: 'Statement day (1-31)', type: 'number', half: true, help: 'Day your bill is generated' },
            { name: 'dueDay', label: 'Payment due day (1-31)', type: 'number', half: true },
          );
        } else if (v.type === 'wallet') {
          f.push({ name: 'bankName', label: 'Provider', placeholder: 'e.g. Paytm, PhonePe, Amazon Pay' }, { name: 'upi', label: 'UPI ID / phone' });
        }
        f.push({ name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Nominee, customer ID, RM contact…' });
        f.push({ name: 'includeNW', label: 'Include in net worth', type: 'checkbox' });
        if (a) f.push({ name: 'archived', label: 'Archive (hide from lists, keep history)', type: 'checkbox' });
        return f;
      },
      onSave: (v) => {
        if (!v.name.trim()) return 'Enter an account name';
        const keep = ['type', 'name', 'openingBalance', 'bankName', 'subtype', 'holder', 'accountNumber', 'ifsc', 'branch', 'upi', 'nominee', 'cardLast4', 'creditLimit', 'statementDay', 'dueDay', 'notes', 'includeNW', 'archived'];
        const rec = {};
        keep.forEach((k) => { if (v[k] !== undefined) rec[k] = typeof v[k] === 'string' ? v[k].trim() : v[k]; });
        rec.openingBalance = num(v.openingBalance);
        if (rec.ifsc) rec.ifsc = rec.ifsc.toUpperCase();
        if (a) Object.assign(a, rec); else S.accounts.push({ id: uid(), ...rec });
        save(); toast(a ? 'Account updated' : 'Account added');
        return true;
      },
      onDelete: a ? () => {
        const n = S.transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length;
        if (!confirm(n ? `Delete "${a.name}" and its ${n} entries? (Tip: use Archive to keep history.)` : `Delete "${a.name}"?`)) return false;
        S.transactions = S.transactions.filter((t) => t.accountId !== a.id && t.toAccountId !== a.id);
        S.accounts = S.accounts.filter((x) => x.id !== a.id);
        save(); st.sub = null; toast('Account deleted'); return true;
      } : null,
    });
  }

  function fdForm(f, opts = {}) {
    const preview = (v) => {
      if (!num(v.principal) || !v.startDate) return '<span class="small muted">Enter amount, rate, start date and tenure to see maturity details.</span>';
      const c = fdCalc(v);
      const payout = v.payout && v.payout !== 'cumulative';
      return [
        kv('Maturity date', fmtDate(c.matISO)),
        payout ? kv(`Interest payout (${v.payout})`, money(c.payoutAmt), { html: true }) : kv('Maturity amount', money(c.maturity), { html: true }),
        kv('Total interest', money(c.interest), { html: true }),
        kv('Value today', money(c.current), { html: true }),
        kv('Tenure', `${c.total} days`),
      ].join('');
    };
    openForm({
      title: f ? 'Edit fixed deposit' : 'New fixed deposit',
      values: f ? { ...f } : { bank: '', principal: '', rate: '', startDate: iso(), tenureMonths: 12, tenureDays: 0, compounding: 'quarterly', payout: 'cumulative', status: 'active', ...(opts.prefill || {}) },
      fields: () => [
        ...(opts.banner ? [{ name: 'scanInfo', type: 'preview', render: () => opts.banner }] : []),
        { name: 'bank', label: 'Bank / Institution', required: true, placeholder: 'e.g. SBI, HDFC, Post Office' },
        { name: 'fdNumber', label: 'FD / receipt number', half: true },
        { name: 'holder', label: 'Holder name', half: true },
        { name: 'principal', label: 'Deposit amount', type: 'number', required: true, half: true },
        { name: 'rate', label: 'Interest rate (% p.a.)', type: 'number', required: true, half: true },
        { name: 'startDate', label: 'Start date', type: 'date', required: true },
        { name: 'tenureMonths', label: 'Tenure — months', type: 'number', half: true },
        { name: 'tenureDays', label: 'Tenure — extra days', type: 'number', half: true },
        { name: 'compounding', label: 'Compounding', type: 'select', half: true, options: [['quarterly', 'Quarterly'], ['monthly', 'Monthly'], ['half-yearly', 'Half-yearly'], ['yearly', 'Yearly'], ['simple', 'Simple interest']] },
        { name: 'payout', label: 'Interest', type: 'select', half: true, options: [['cumulative', 'Cumulative (at maturity)'], ['monthly', 'Paid monthly'], ['quarterly', 'Paid quarterly'], ['half-yearly', 'Paid half-yearly'], ['yearly', 'Paid yearly']] },
        { name: 'maturityOverride', label: 'Maturity amount as per bank (optional)', type: 'number', help: 'Leave blank to auto-calculate. Fill it to match your FD receipt exactly.' },
        { name: 'pv', type: 'preview', render: preview },
        { name: 'linkedAccountId', label: 'Linked / payout account', type: 'select', options: [['', '—'], ...S.accounts.map((a) => [a.id, a.name])] },
        { name: 'nominee', label: 'Nominee', half: true },
        { name: 'autoRenew', label: 'Auto-renew', type: 'select', half: true, options: [['', '—'], ['yes', 'Yes'], ['no', 'No']] },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSave: (v) => {
        if (!v.bank.trim()) return 'Enter the bank name';
        if (!(num(v.principal) > 0)) return 'Enter the deposit amount';
        if (!(num(v.rate) >= 0) || v.rate === '') return 'Enter the interest rate';
        if (!(num(v.tenureMonths) + num(v.tenureDays) > 0)) return 'Enter the tenure';
        const keep = ['bank', 'fdNumber', 'holder', 'principal', 'rate', 'startDate', 'tenureMonths', 'tenureDays', 'compounding', 'payout', 'maturityOverride', 'linkedAccountId', 'nominee', 'autoRenew', 'notes'];
        const rec = {}; keep.forEach((k) => { rec[k] = typeof v[k] === 'string' ? v[k].trim() : v[k]; });
        ['principal', 'rate', 'tenureMonths', 'tenureDays'].forEach((k) => { rec[k] = num(rec[k]); });
        rec.maturityOverride = num(rec.maturityOverride) || '';
        if (f) Object.assign(f, rec);
        else { const nf = { id: uid(), status: 'active', ...rec }; if (opts.docId) nf.docId = opts.docId; S.fds.push(nf); linkScannedFile(opts, nf, 'fd'); }
        save(); toast(f ? 'FD updated' : 'FD added');
        return true;
      },
      extra: !f ? (opts.prefill ? [] : [{ label: '📷 Scan receipt', act: () => { pickFileThen((file) => scanDocument(file, { hint: 'fd' })); return true; } }]) : [
        ...(f.docId && S.documents.some((d) => d.id === f.docId) ? [{ label: '📄 Receipt', act: () => { openDocument(S.documents.find((d) => d.id === f.docId)); return false; } }] : []), {
        label: f.status === 'closed' ? 'Re-open' : 'Mark closed',
        act: () => {
          if (f.status !== 'closed' && !confirm('Mark this FD as closed/redeemed? It will no longer count in net worth.')) return false;
          f.status = f.status === 'closed' ? 'active' : 'closed'; f.closedOn = f.status === 'closed' ? iso() : '';
          save(); toast(f.status === 'closed' ? 'FD closed' : 'FD re-opened'); return true;
        },
      }],
      onDelete: f ? () => { if (!confirm('Delete this FD?')) return false; S.fds = S.fds.filter((x) => x.id !== f.id); save(); toast('FD deleted'); return true; } : null,
    });
  }

  function assetForm(x, kind = 'asset') {
    const k = x ? x.kind : kind;
    openForm({
      title: (x ? 'Edit ' : 'New ') + (k === 'liability' ? 'liability' : 'asset'),
      values: x ? { ...x } : { kind: k, name: '', category: '', value: '', asOf: iso() },
      fields: () => [
        { name: 'name', label: 'Name', required: true, placeholder: k === 'liability' ? 'e.g. Home loan — HDFC' : 'e.g. Gold jewellery, Zerodha portfolio' },
        { name: 'category', label: 'Category', type: 'list', options: k === 'liability' ? LIAB_CATS : ASSET_CATS, half: true },
        { name: 'value', label: k === 'liability' ? 'Outstanding amount' : 'Current value', type: 'number', required: true, half: true },
        { name: 'asOf', label: 'Value as of', type: 'date' },
        ...(k === 'liability' ? [{ name: 'emi', label: 'EMI', type: 'number', half: true }, { name: 'rate', label: 'Interest rate %', type: 'number', half: true }] : []),
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) return 'Enter a name';
        const rec = { kind: k, name: v.name.trim(), category: (v.category || '').trim(), value: num(v.value), asOf: v.asOf, emi: num(v.emi) || '', rate: num(v.rate) || '', notes: (v.notes || '').trim() };
        if (x) Object.assign(x, rec); else S.assets.push({ id: uid(), ...rec });
        save(); toast('Saved'); return true;
      },
      onDelete: x ? () => { if (!confirm('Delete this item?')) return false; S.assets = S.assets.filter((y) => y.id !== x.id); save(); return true; } : null,
    });
  }

  // ---------- Export / import ----------
  async function shareOrDownload(filename, text, mime) {
    const Filesystem = plugin('Filesystem'), Share = plugin('Share');
    if (Filesystem && Share) {
      try {
        const r = await Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
        await Share.share({ title: filename, url: r.uri, dialogTitle: 'Save or send backup' });
        return true;
      } catch (e) {
        if (String(e && e.message).toLowerCase().includes('cancel')) return false;
        console.error(e);
      }
    }
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }

  async function exportJson() {
    const ok = await shareOrDownload(`account-manager-backup-${iso()}.json`, JSON.stringify(S, null, 2), 'application/json');
    if (ok) { S.settings.lastBackup = iso(); save(); render(); toast('Backup exported'); }
  }

  function exportCsv() {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Type', 'Account', 'To Account', 'Category', 'Payment Mode', 'Amount', 'Note']];
    [...S.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => rows.push([t.date, t.type, accName(t.accountId), t.toAccountId ? accName(t.toAccountId) : '', t.category, MODE_LABEL[modeOf(t)] || '', t.amount, t.note]));
    shareOrDownload(`account-manager-entries-${iso()}.csv`, rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
  }

  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.accounts) || !Array.isArray(d.transactions)) throw new Error('Not an Account Manager backup');
        if (!confirm(`Replace current data${signedIn() ? ' (on this device AND in your cloud account)' : ''} with this backup?\n\n${d.accounts.length} accounts, ${d.transactions.length} entries, ${(d.fds || []).length} FDs`)) return;
        const keep = new Set((d.documents || []).map((x) => x.id));
        S.documents.filter((x) => !keep.has(x.id)).forEach(removeDocFiles);
        S = migrate(d); save(); st.sub = null; st.tab = 'home'; render(); toast('Backup restored');
      } catch (err) { alert('Could not import: ' + err.message); }
    };
    r.readAsText(file);
  });

  // ---------- Demo data ----------
  function loadDemo() {
    const sbi = uid(), hdfc = uid(), cash = uid(), cc = uid(), upi = uid();
    const t0 = new Date();
    const d = (daysAgo) => { const x = new Date(t0); x.setDate(x.getDate() - daysAgo); return iso(x); };
    S.accounts.push(
      { id: sbi, name: 'SBI Savings', type: 'bank', openingBalance: 85000, bankName: 'State Bank of India', subtype: 'Savings', holder: 'Your Name', accountNumber: '30012345678', ifsc: 'SBIN0001234', branch: 'MG Road', includeNW: true },
      { id: hdfc, name: 'HDFC Salary', type: 'bank', openingBalance: 42000, bankName: 'HDFC Bank', subtype: 'Salary', accountNumber: '50100123456789', ifsc: 'HDFC0000123', includeNW: true },
      { id: cash, name: 'Wallet Cash', type: 'cash', openingBalance: 3500, includeNW: true },
      { id: upi, name: 'Paytm Wallet', type: 'wallet', openingBalance: 1200, bankName: 'Paytm', includeNW: true },
      { id: cc, name: 'ICICI Amazon Pay', type: 'credit', openingBalance: -4500, bankName: 'ICICI', cardLast4: '4321', creditLimit: 150000, dueDay: 18, includeNW: true },
    );
    const modeFor = (acc, type) => (type === 'transfer' ? '' : acc === cash ? 'cash' : acc === cc ? 'card' : acc === upi ? 'upi' : type === 'income' ? 'bank' : 'upi');
    const add = (type, amount, accountId, category, daysAgo, note = '', toAccountId = '') => S.transactions.push({ id: uid(), type, amount, accountId, toAccountId, category, mode: modeFor(accountId, type), date: d(daysAgo), note, created: new Date().toISOString() });
    for (let m = 0; m < 6; m++) {
      const o = m * 30;
      add('income', 75000, hdfc, 'Salary', o + 1, 'Monthly salary');
      add('expense', 18000, hdfc, 'Rent', o + 2);
      add('transfer', 15000, hdfc, '', o + 3, 'Savings', sbi);
      add('expense', 4200 + m * 150, cc, 'Groceries', o + 5, 'BigBasket');
      add('expense', 1800 + (m % 3) * 400, cash, 'Food & Dining', o + 8);
      add('expense', 2500, upi, 'Fuel', o + 10);
      add('expense', 999, hdfc, 'Mobile & Internet', o + 12, 'Fiber + mobile');
      add('transfer', 4000, sbi, '', o + 4, 'ATM withdrawal', cash);
      add('transfer', 3000, sbi, '', o + 4, 'Wallet top-up', upi);
      add('transfer', 7500 + (m % 2) * 2500, hdfc, '', o + 17, 'Card bill payment', cc);
      add('expense', 3000 + (m % 2) * 2500, cc, 'Shopping', o + 15);
      add('expense', 5000, hdfc, 'Investment', o + 6, 'SIP');
      if (m % 2 === 0) add('income', 8000, sbi, 'Freelance', o + 20);
      if (m % 3 === 1) add('expense', 2200, cash, 'Health', o + 22, 'Pharmacy');
    }
    S.fds.push(
      { id: uid(), bank: 'SBI', fdNumber: 'FD-112233', principal: 200000, rate: 7.1, startDate: d(330), tenureMonths: 12, tenureDays: 0, compounding: 'quarterly', payout: 'cumulative', status: 'active', linkedAccountId: sbi, nominee: 'Spouse' },
      { id: uid(), bank: 'HDFC Bank', fdNumber: 'HD-9988', principal: 150000, rate: 7.4, startDate: d(120), tenureMonths: 24, tenureDays: 0, compounding: 'quarterly', payout: 'cumulative', status: 'active' },
      { id: uid(), bank: 'Post Office TD', principal: 100000, rate: 7.5, startDate: d(400), tenureMonths: 60, tenureDays: 0, compounding: 'quarterly', payout: 'yearly', status: 'active' },
    );
    S.ppf.push({ id: uid(), status: 'active', holder: 'Self', bank: 'SBI', accountNumber: '32145678901', openDate: '2019-06-15', openingBalance: 812000, balanceDate: iso(new Date(t0.getFullYear() - (t0.getMonth() < 3 ? 1 : 0), 3, 1)), rate: 7.1, yearlyPlan: 150000, extensions: 0, nominee: 'Spouse', linkedAccountId: sbi,
      deposits: [{ id: uid(), type: 'deposit', amount: 50000, date: iso(new Date(t0.getFullYear() - (t0.getMonth() < 3 ? 1 : 0), 3, 4)), note: '' }, { id: uid(), type: 'deposit', amount: 25000, date: d(40), note: '' }] });
    const st0 = new Date(t0); st0.setDate(st0.getDate() - 6);
    S.accounts.find((a) => a.id === cc).statementDay = st0.getDate();
    S.accounts.find((a) => a.id === cc).dueDay = new Date(st0.getFullYear(), st0.getMonth(), st0.getDate() + 18).getDate();
    S.bills.push(
      { id: uid(), kind: 'bill', name: 'Electricity (MSEDCL)', category: 'Bills & Utilities', consumerNo: '170012345678', amount: '', frequency: 'monthly', nextDue: d(-3), accountId: hdfc, mode: 'upi', autoPay: false, active: true },
      { id: uid(), kind: 'bill', name: 'Airtel Fiber', category: 'Mobile & Internet', amount: 999, frequency: 'monthly', nextDue: d(-12), accountId: hdfc, mode: 'card', autoPay: true, active: true },
      { id: uid(), kind: 'subscription', name: 'Netflix', category: 'Entertainment', amount: 649, frequency: 'monthly', nextDue: d(-20), accountId: cc, mode: 'card', autoPay: true, active: true },
      { id: uid(), kind: 'subscription', name: 'Amazon Prime', category: 'Entertainment', amount: 1499, frequency: 'yearly', nextDue: d(-90), accountId: cc, mode: 'card', autoPay: false, active: true },
    );
    S.warranties.push({ id: uid(), product: 'iPhone 15', brand: 'Apple', serial: '35xxxxxxxxxx', purchaseDate: d(345), price: 72900, store: 'Croma', months: 12, billDocId: '' },
      { id: uid(), product: 'Washing machine', brand: 'LG', purchaseDate: d(400), price: 32990, store: 'Amazon', months: 24, extendedMonths: 0, billDocId: '' });
    S.vehicles.push({ id: uid(), type: 'car', name: 'Swift', regNo: 'MH12AB1234', fuelType: 'petrol', model: 'Maruti Swift ZXi 2022', odometer: 24650, insuranceDue: d(-40), pucDue: d(-9), serviceDue: d(-60), serviceDueKm: 25000,
      logs: [{ id: uid(), kind: 'fuel', amount: 3150, litres: 30, odo: 23650, full: true, date: d(50) }, { id: uid(), kind: 'fuel', amount: 2205, litres: 21, odo: 24080, full: true, date: d(28) },
        { id: uid(), kind: 'fuel', amount: 2520, litres: 24, odo: 24600, full: true, date: d(6) }, { id: uid(), kind: 'service', amount: 6400, odo: 20100, note: '20,000 km service', date: d(120) }] });
    S.budgets = { __total: 45000, 'Food & Dining': 3000, Shopping: 5000, Groceries: 5000 };
    S.assets.push(
      { id: uid(), kind: 'asset', name: 'Gold jewellery (40g)', category: 'Gold', value: 290000, asOf: iso() },
      { id: uid(), kind: 'asset', name: 'Mutual fund portfolio', category: 'Mutual Funds', value: 185000, asOf: iso() },
      { id: uid(), kind: 'liability', name: 'Car loan — Axis', category: 'Car Loan', value: 260000, emi: 11500, rate: 9.2, asOf: iso() },
    );
    save(); st.sub = null; st.tab = 'home'; render(); toast('Sample data loaded');
  }

  // ---------- Toast & clipboard ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {} ta.remove();
    }
    toast('Copied');
  }

  // =====================================================================
  // v1.3 features: payment modes, PPF, documents, recurring, budgets,
  // reminders, PIN lock
  // =====================================================================
  const PAY_MODES = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['bank', 'Netbanking']];
  const MODE_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Net Banking', cheque: 'Cheque' };
  const defMode = (accId) => { const a = S.accounts.find((x) => x.id === accId); return !a ? 'upi' : a.type === 'cash' ? 'cash' : a.type === 'credit' ? 'card' : 'upi'; };
  const modeOf = (t) => t.mode || ((S.accounts.find((a) => a.id === t.accountId) || {}).type === 'cash' ? 'cash' : '');
  const PPF_LIMIT = 150000;
  const DOC_CATS = ['ID Proofs', 'Bank', 'Insurance', 'Property', 'Vehicle', 'Tax & ITR', 'Investments', 'Medical', 'Education', 'Employment', 'Bills & Receipts', 'Other'];
  const MAX_FILE = 15 * 1024 * 1024;
  const CHUNK = 800 * 1024;
  const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const fyOf = (d) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1); // FY start year
  const fyLabel = (y) => `FY ${y}-${String(y + 1).slice(2)}`;

  // ---------- Reusable option blocks for the Entries filter / Home ----------
  function cashOnlineCard(tx) {
    const exp = tx.filter((t) => t.type === 'expense');
    if (!exp.length) return '';
    let cash = 0, online = 0, unset = 0;
    const by = {};
    exp.forEach((t) => { const m = modeOf(t), a = num(t.amount); if (m === 'cash') cash += a; else if (m) { online += a; by[m] = (by[m] || 0) + a; } else unset += a; });
    const total = cash + online + unset || 1;
    const pct = (v) => (v / total) * 100;
    const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${MODE_LABEL[m] || m} ${esc(fmt(v))}`).join(' · ');
    return `<div class="card"><h2>Cash vs Online (expenses)</h2>
      <div class="stack"><i style="width:${pct(cash)}%;background:var(--warn)"></i><i style="width:${pct(online)}%;background:var(--brand)"></i><i style="width:${pct(unset)}%;background:var(--chip)"></i></div>
      <div class="grid2" style="margin-top:10px"><div><span class="dot" style="background:var(--warn)"></span>Cash<br><b>${money(cash)}</b> <span class="muted small">${Math.round(pct(cash))}%</span></div>
      <div><span class="dot" style="background:var(--brand)"></span>Online<br><b>${money(online)}</b> <span class="muted small">${Math.round(pct(online))}%</span></div></div>
      ${parts ? `<div class="small muted" style="margin-top:8px"><span class="amt">${parts}</span></div>` : ''}
      ${unset ? `<div class="small muted" style="margin-top:4px">Not specified: <span class="amt">${esc(fmt(unset))}</span></div>` : ''}</div>`;
  }

  // ---------- Budgets ----------
  function budgetRows(month) {
    const keys = Object.keys(S.budgets || {}).filter((k) => num(S.budgets[k]) > 0);
    if (!keys.length) return [];
    const tx = S.transactions.filter((t) => t.type === 'expense' && t.date.slice(0, 7) === month);
    return keys.map((k) => {
      const spent = sum(k === '__total' ? tx.filter((t) => t.category !== 'Investment') : tx.filter((t) => (t.category || 'Other') === k));
      const limit = num(S.budgets[k]);
      return { k, name: k === '__total' ? 'Overall' : k, spent, limit, p: spent / limit };
    }).sort((a, b) => (a.k === '__total' ? -1 : b.k === '__total' ? 1 : b.p - a.p));
  }
  function budgetHtml(r, act = true) {
    const cls = r.p > 1 ? 'over' : r.p > 0.8 ? 'warn' : '';
    return `<div class="catrow" ${act ? `data-act="edit-budget" data-k="${esc(r.k)}" style="cursor:pointer"` : ''}><div class="row"><span class="grow ellipsis">${esc(r.name)}</span>
      <span class="small ${r.p > 1 ? 'neg' : 'muted'}">${r.p > 1 ? 'Over by ' + esc(fmt(r.spent - r.limit)) : esc(fmt(r.limit - r.spent)) + ' left'}</span></div>
      <div class="bar"><i class="${cls}" style="width:${Math.min(100, r.p * 100)}%"></i></div>
      <div class="small muted amt">${esc(fmt(r.spent))} of ${esc(fmt(r.limit))}</div></div>`;
  }
  function viewBudgets() {
    const rows = budgetRows(st.month);
    return monthNav() + `<p class="small muted" style="margin-top:0">Set a monthly spending limit overall or per category (the overall budget leaves out the “Investment” category, e.g. SIP or PPF). You'll see progress on Home and a warning when you cross 80%.</p>
      <div class="card">${rows.length ? rows.map((r) => budgetHtml(r)).join('') : '<div class="empty">No budgets yet.</div>'}</div>
      <button class="btn primary block" data-act="edit-budget">+ Add budget</button>`;
  }
  function budgetForm(k) {
    const used = Object.keys(S.budgets || {});
    const opts = [['__total', 'Overall (all expenses)'], ...S.categories.expense.map((c) => [c, c])].filter(([v]) => v === k || !used.includes(v));
    openForm({
      title: k ? 'Edit budget' : 'New budget',
      values: { k: k || opts[0][0], amount: k ? S.budgets[k] : '' },
      fields: () => [
        { name: 'k', label: 'Category', type: 'select', options: opts },
        { name: 'amount', label: 'Monthly limit', type: 'number', big: true, required: true },
      ],
      onSave: (v) => {
        if (!(num(v.amount) > 0)) return 'Enter a limit';
        S.budgets = { ...(S.budgets || {}) };
        if (k && k !== v.k) delete S.budgets[k];
        S.budgets[v.k] = num(v.amount); save(); toast('Budget saved'); return true;
      },
      onDelete: k ? () => { S.budgets = { ...S.budgets }; delete S.budgets[k]; save(); return true; } : null,
    });
  }

  // ---------- Recurring entries ----------
  function occurrence(r, k) {
    const s = parseDate(r.startDate);
    if (r.freq === 'weekly') { const d = new Date(s); d.setDate(d.getDate() + 7 * k); return iso(d); }
    return iso(addTenure(s, (r.freq === 'yearly' ? 12 : 1) * k, 0));
  }
  function nextOccurrence(r) {
    for (let k = 0; k < 5000; k++) { const d = occurrence(r, k); if (!r.lastRun || d > r.lastRun) return d; }
    return '';
  }
  function runRecurring() {
    const today = iso(); let added = 0;
    for (const r of S.recurring) {
      if (!r.active || !r.startDate) continue;
      for (let k = 0; k < 5000; k++) {
        const d = occurrence(r, k);
        if (d > today || (r.endDate && d > r.endDate)) break;
        if (r.lastRun && d <= r.lastRun) continue;
        const id = `r_${r.id}_${d}`;
        if (!S.transactions.some((t) => t.id === id)) {
          S.transactions.push({ id, type: r.type, amount: num(r.amount), accountId: r.accountId, toAccountId: r.toAccountId || '', category: r.category || '', mode: r.mode || '', note: r.note || '', date: d, created: new Date().toISOString(), recurringId: r.id });
          added++;
        }
        r.lastRun = d;
      }
    }
    added += runAutoBills();
    if (added) { save(); toast(`${added} recurring / auto-debit entr${added > 1 ? 'ies' : 'y'} added`); }
    return added;
  }
  const FREQ = [['monthly', 'Every month'], ['weekly', 'Every week'], ['yearly', 'Every year']];
  function viewRecurring() {
    const list = S.recurring;
    return `<p class="small muted" style="margin-top:0">Entries like salary, rent, SIP or subscriptions are added automatically on their date. To make one, pick “Repeat” when adding an entry.</p>
      ${list.length ? `<div class="list">${list.map((r) => `<button class="item" data-act="edit-rec" data-id="${r.id}">
        <div class="avatar ${r.type}">${r.type === 'transfer' ? ICON.xfer : r.type === 'income' ? ICON.in : ICON.out}</div>
        <div class="grow"><div class="title ellipsis">${esc(r.type === 'transfer' ? 'Transfer' : r.category)} ${r.active ? '' : '<span class="badge">Paused</span>'}</div>
        <div class="sub ellipsis">${esc((FREQ.find((f) => f[0] === r.freq) || FREQ[0])[1])} · ${esc(accName(r.accountId))}${r.active ? ' · next ' + fmtDate(nextOccurrence(r)) : ''}</div></div>
        <div class="right"><b>${money(r.amount, r.type === 'income' ? 'pos' : r.type === 'expense' ? 'neg' : '')}</b></div></button>`).join('')}</div>`
        : '<div class="list"><div class="empty"><div class="em">🔁</div>No recurring entries yet.</div></div>'}`;
  }
  function recurringForm(r) {
    const accOpts = S.accounts.map((a) => [a.id, `${accIcon(a)} ${a.name}`]);
    openForm({
      title: 'Recurring entry',
      values: { ...r },
      fields: (v) => [
        { name: 'amount', label: 'Amount', type: 'number', big: true },
        { name: 'accountId', label: r.type === 'transfer' ? 'From account' : 'Account', type: 'select', options: accOpts },
        ...(r.type === 'transfer' ? [{ name: 'toAccountId', label: 'To account', type: 'select', options: accOpts }]
          : [{ name: 'category', label: 'Category', type: 'list', options: S.categories[r.type] || [] },
            { name: 'mode', type: 'segment', options: PAY_MODES }]),
        { name: 'freq', label: 'Repeats', type: 'select', options: FREQ, half: true },
        { name: 'endDate', label: 'End date (optional)', type: 'date', half: true },
        { name: 'note', label: 'Note' },
        { name: 'active', label: 'Active (uncheck to pause)', type: 'checkbox' },
        { name: 'info', type: 'preview', render: () => `<span class="small">Started ${fmtDate(r.startDate)}. Changes apply to future entries only.${v.active ? ' Next: ' + fmtDate(nextOccurrence({ ...r, ...v })) : ''}</span>` },
      ],
      onSave: (v) => {
        if (!(num(v.amount) > 0)) return 'Enter an amount';
        Object.assign(r, { amount: num(v.amount), accountId: v.accountId, toAccountId: v.toAccountId || '', category: (v.category || '').trim(), mode: v.mode || '', freq: v.freq, endDate: v.endDate || '', note: (v.note || '').trim(), active: !!v.active });
        save(); runRecurring(); toast('Saved'); return true;
      },
      onDelete: () => {
        if (!confirm('Stop this recurring entry? Entries already added are kept.')) return false;
        S.recurring = S.recurring.filter((x) => x.id !== r.id); save(); return true;
      },
    });
  }

  // ---------- PPF ----------
  function ppfCalc(p, asOf = new Date()) {
    const rate = num(p.rate === '' || p.rate == null ? 7.1 : p.rate) / 100;
    const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
    const open = parseDate(p.openDate || iso());
    const fyOpenEnd = fyOf(open) + 1; // FY in which account opened ends 31 Mar of this year
    const maturity = new Date(fyOpenEnd + 15 + 5 * num(p.extensions), 3, 1);
    const deps = [...(p.deposits || [])].sort((a, b) => a.date.localeCompare(b.date));
    const usePass = num(p.openingBalance) > 0 && p.balanceDate;
    const startStr = usePass ? p.balanceDate : (p.openDate || iso());
    let bal = usePass ? num(p.openingBalance) : 0;
    let accrued = 0, interest = 0;
    const tracked = deps.filter((d) => (usePass ? d.date > startStr : d.date >= startStr));
    const start = parseDate(startStr);
    let y = start.getFullYear(), m = start.getMonth();
    for (let guard = 0; guard < 1200; guard++) {
      const ms = new Date(y, m, 1), me = new Date(y, m + 1, 0);
      if (ms > today) break;
      const key = iso(ms).slice(0, 7);
      let early = 0, all = 0, wd = 0;
      tracked.forEach((d) => {
        if (d.date.slice(0, 7) !== key) return;
        const a = num(d.amount);
        if (d.type === 'withdrawal') wd += a; else { all += a; if (parseDate(d.date).getDate() <= 5) early += a; }
      });
      const complete = me < today;
      if (complete && ms < maturity) accrued += Math.max(0, bal + early - wd) * rate / 12;
      bal += all - wd;
      if (m === 2 && complete) { bal += accrued; interest += accrued; accrued = 0; }
      if (++m > 11) { m = 0; y++; }
    }
    const fy = fyOf(today);
    const fyS = iso(new Date(fy, 3, 1)), fyE = iso(new Date(fy + 1, 2, 31));
    const fyDeposited = deps.filter((d) => d.type !== 'withdrawal' && d.date >= fyS && d.date <= fyE).reduce((s, d) => s + num(d.amount), 0);
    const deposited = deps.filter((d) => d.type !== 'withdrawal').reduce((s, d) => s + num(d.amount), 0);
    const withdrawn = deps.filter((d) => d.type === 'withdrawal').reduce((s, d) => s + num(d.amount), 0);
    const current = bal + accrued;
    const yearsLeft = Math.max(0, (maturity - today) / (365.25 * 864e5));
    const n = Math.max(0, Math.round(yearsLeft));
    const plan = num(p.yearlyPlan);
    const g = Math.pow(1 + rate, n);
    const projected = current * g + (rate ? plan * ((g - 1) / rate) * (1 + rate) : plan * n);
    return {
      balance: bal, accrued, current, interest: interest + accrued, deposited, withdrawn, fyDeposited, fy, fyLeft: Math.max(0, PPF_LIMIT - fyDeposited),
      maturity, matISO: iso(maturity), daysLeft: daysBetween(today, maturity), yearsLeft, projected, plan, rate,
      loanFrom: new Date(fyOpenEnd + 1, 3, 1), withdrawFrom: new Date(fyOpenEnd + 5, 3, 1), usePass, startStr,
    };
  }
  function ppfItem(p) {
    const c = ppfCalc(p);
    return `<button class="item" data-act="open-ppf" data-id="${p.id}" style="flex-wrap:wrap">
      <div class="avatar">🏛️</div>
      <div class="grow"><div class="title ellipsis">${esc(p.holder || 'PPF')} · ${esc(p.bank || '')} ${p.status === 'closed' ? '<span class="badge">Closed</span>' : c.daysLeft <= 0 ? '<span class="badge warn">Matured</span>' : ''}</div>
        <div class="sub">${fyLabel(c.fy)}: <span class="amt">${esc(fmt(c.fyDeposited))}</span> of ₹1.5L · matures ${fmtDate(c.matISO)}</div></div>
      <div class="right"><b>${money(c.current)}</b></div>
      <div class="bar" style="flex-basis:100%;margin-left:52px;height:5px"><i style="width:${Math.min(100, (c.fyDeposited / PPF_LIMIT) * 100)}%"></i></div></button>`;
  }
  function viewPpf() {
    const active = S.ppf.filter((p) => p.status !== 'closed');
    const calcs = active.map((p) => ppfCalc(p));
    const total = calcs.reduce((s, c) => s + c.current, 0);
    const dep = calcs.reduce((s, c) => s + c.deposited, 0);
    const fyDep = calcs.reduce((s, c) => s + c.fyDeposited, 0);
    return `<div class="card hero"><div class="label">PPF balance (estimated)</div><div class="big amt">${esc(fmt(total))}</div>
      <div class="split"><div><small>${fyLabel(fyOf(new Date()))} deposits</small><b class="amt">${esc(fmt(fyDep))}</b></div><div><small>Total deposited</small><b class="amt">${esc(fmt(dep))}</b></div></div></div>
      <div class="row" style="margin-bottom:12px"><div class="grow small muted">Tax-free · 80C · 15-year lock-in</div><button class="btn primary" data-act="add-ppf">+ PPF account</button></div>
      ${S.ppf.length ? `<div class="list">${S.ppf.map(ppfItem).join('')}</div>`
        : `<div class="list"><div class="empty"><div class="em">🏛️</div>Add your PPF account (yours, spouse's or child's) to track deposits, interest, the ₹1.5 lakh yearly limit and maturity.</div></div>`}`;
  }
  function viewPpfDetail(id) {
    const p = S.ppf.find((x) => x.id === id);
    if (!p) { st.sub = null; return viewInvest(); }
    const c = ppfCalc(p);
    const today = new Date();
    const fyPct = Math.min(100, (c.fyDeposited / PPF_LIMIT) * 100);
    const deps = [...(p.deposits || [])].sort((a, b) => b.date.localeCompare(a.date));
    const groups = {};
    deps.forEach((d) => { const y = fyOf(parseDate(d.date)); (groups[y] = groups[y] || []).push(d); });
    const revKey = 'ppf' + p.id;
    const elig = [
      today >= c.withdrawFrom ? '✅ Partial withdrawal allowed (once a year)' : `Partial withdrawal from ${fmtDate(iso(c.withdrawFrom))}`,
      today >= c.loanFrom && today < c.withdrawFrom ? '✅ Loan against PPF available' : today < c.loanFrom ? `Loan against PPF from ${fmtDate(iso(c.loanFrom))}` : '',
    ].filter(Boolean);
    return `<div class="card hero"><div class="label">${esc(p.holder || 'PPF')} · ${esc(p.bank || '')}</div>
      <div class="big amt">${esc(fmt(c.current))}</div>
      <div class="split"><div><small>Total deposited</small><b class="amt">${esc(fmt(c.deposited))}</b></div><div><small>Interest earned${c.usePass ? ' since ' + fmtDate(c.startStr) : ''}</small><b class="amt">${esc(fmt(c.interest))}</b></div></div></div>
      <div class="btn-row" style="margin-bottom:14px"><button class="btn primary" data-act="add-ppf-dep" data-id="${p.id}">+ Deposit</button><button class="btn" data-act="edit-ppf" data-id="${p.id}">Edit details</button></div>
      <div class="card"><h2>${fyLabel(c.fy)} — yearly limit</h2>
        <div class="row" style="margin-bottom:6px"><b class="grow amt">${esc(fmt(c.fyDeposited))}</b><span class="muted small amt">of ${esc(fmt(PPF_LIMIT))}</span></div>
        <div class="bar"><i class="${c.fyDeposited > PPF_LIMIT ? 'over' : ''}" style="width:${fyPct}%"></i></div>
        <div class="small muted" style="margin-top:6px">${c.fyDeposited < 500 ? '⚠️ Deposit at least ₹500 before 31 March to keep the account active. ' : ''}${c.fyLeft ? `You can still invest <b class="amt">${esc(fmt(c.fyLeft))}</b> this year.` : 'Yearly limit reached.'} Deposit before the 5th of a month to earn interest for that month.</div></div>
      <div class="card"><h2>Maturity</h2>
        ${kv('Maturity date', fmtDate(c.matISO) + (c.daysLeft > 0 ? ` (${c.yearsLeft.toFixed(1)} yrs left)` : ' — matured'))}
        ${kv('Interest rate', (c.rate * 100).toFixed(2) + '% p.a.')}
        ${c.plan && c.daysLeft > 0 ? kv(`Est. value if you deposit ${fmt(c.plan)}/yr`, money(c.projected), { html: true }) : ''}
        ${kv('Interest accrued this FY (credited 31 Mar)', money(c.accrued), { html: true })}
        ${elig.map((e) => `<div class="kv"><span>${esc(e)}</span></div>`).join('')}</div>
      <div class="card"><h2>Account details</h2>
        ${kv('Account number', p.accountNumber ? (st.reveal[revKey] ? p.accountNumber : mask(p.accountNumber)) : '', { reveal: p.accountNumber ? revKey : null, copy: p.accountNumber })}
        ${kv('Opened on', fmtDate(p.openDate))}
        ${kv('Linked account', p.linkedAccountId ? accName(p.linkedAccountId) : '')}
        ${kv('Nominee', p.nominee)}
        ${kv('Extended', num(p.extensions) ? `${5 * num(p.extensions)} years` : '')}
        ${kv('Notes', p.notes)}</div>
      <div class="section-title">Deposits & withdrawals</div>
      ${deps.length ? `<div class="list">${Object.keys(groups).sort((a, b) => b - a).map((y) => {
        const tot = groups[y].reduce((s, d) => s + (d.type === 'withdrawal' ? -1 : 1) * num(d.amount), 0);
        return `<div class="day-head"><span>${fyLabel(+y)}</span><span class="amt">${esc(fmt(tot))}</span></div>` + groups[y].map((d) => `
          <button class="item" data-act="edit-ppf-dep" data-id="${p.id}" data-dep="${d.id}"><div class="avatar ${d.type === 'withdrawal' ? 'expense' : 'income'}">${d.type === 'withdrawal' ? ICON.out : ICON.in}</div>
          <div class="grow"><div class="title">${d.type === 'withdrawal' ? 'Withdrawal' : 'Deposit'}</div><div class="sub">${fmtDate(d.date)}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
          <div class="right"><b>${money(d.amount, d.type === 'withdrawal' ? 'neg' : 'pos')}</b></div></button>`).join('');
      }).join('')}</div>` : '<div class="list"><div class="empty">No deposits recorded yet.</div></div>'}`;
  }
  function ppfForm(p) {
    openForm({
      title: p ? 'Edit PPF account' : 'New PPF account',
      values: p ? { ...p } : { holder: S.settings.name || '', bank: '', openDate: '', rate: 7.1, yearlyPlan: PPF_LIMIT, extensions: 0, openingBalance: '', balanceDate: iso() },
      fields: () => [
        { name: 'holder', label: 'Account holder', half: true, placeholder: 'e.g. Self, Spouse, Child' },
        { name: 'bank', label: 'Bank / Post Office', type: 'list', half: true, options: ['Post Office', 'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Bank of Baroda', 'PNB', 'Canara Bank', 'Union Bank', 'Kotak Bank'] },
        { name: 'accountNumber', label: 'PPF account number' },
        { name: 'openDate', label: 'Account opening date', type: 'date', required: true, help: 'Decides your maturity date (15 full financial years).' },
        { name: 'openingBalance', label: 'Current balance as per passbook', type: 'number', half: true, help: 'For an existing account. Leave blank to start from zero.' },
        { name: 'balanceDate', label: 'Passbook balance as on', type: 'date', half: true },
        { name: 'rate', label: 'Interest rate (% p.a.)', type: 'number', half: true, help: 'Set by Govt. every quarter' },
        { name: 'yearlyPlan', label: 'Planned deposit per year', type: 'number', half: true, help: 'Used for maturity estimate' },
        { name: 'extensions', label: 'Extension after 15 years', type: 'select', options: [[0, 'Not extended'], [1, 'Extended +5 years'], [2, 'Extended +10 years'], [3, 'Extended +15 years']] },
        { name: 'linkedAccountId', label: 'Linked bank account', type: 'select', options: [['', '—'], ...S.accounts.map((a) => [a.id, a.name])] },
        { name: 'nominee', label: 'Nominee' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSave: (v) => {
        if (!v.openDate) return 'Enter the account opening date';
        const rec = {};
        ['holder', 'bank', 'accountNumber', 'openDate', 'balanceDate', 'linkedAccountId', 'nominee', 'notes'].forEach((k) => { rec[k] = (v[k] || '').trim(); });
        ['openingBalance', 'rate', 'yearlyPlan', 'extensions'].forEach((k) => { rec[k] = num(v[k]); });
        if (!rec.openingBalance) rec.balanceDate = '';
        if (p) Object.assign(p, rec); else S.ppf.push({ id: uid(), status: 'active', deposits: [], ...rec });
        save(); toast('PPF saved'); return true;
      },
      extra: p ? [{ label: p.status === 'closed' ? 'Re-open' : 'Mark closed', act: () => { p.status = p.status === 'closed' ? 'active' : 'closed'; save(); return true; } }] : [],
      onDelete: p ? () => { if (!confirm('Delete this PPF account and its deposit history?')) return false; S.ppf = S.ppf.filter((x) => x.id !== p.id); save(); st.sub = null; return true; } : null,
    });
  }
  function ppfDepositForm(p, d) {
    const accOpts = [['', 'Don’t record in an account'], ...S.accounts.filter((a) => !a.archived).map((a) => [a.id, `${accIcon(a)} ${a.name}`])];
    const linked = d && d.txnId ? S.transactions.find((t) => t.id === d.txnId) : null;
    openForm({
      title: d ? 'Edit PPF transaction' : 'PPF deposit',
      values: d ? { ...d, fromAccount: linked ? linked.accountId : '' } : { type: 'deposit', amount: '', date: iso(), fromAccount: p.linkedAccountId || '', note: '' },
      fields: (v) => [
        { name: 'type', type: 'segment', options: [['deposit', 'Deposit'], ['withdrawal', 'Withdrawal']] },
        { name: 'amount', label: 'Amount', type: 'number', big: true, required: true },
        { name: 'date', label: 'Date', type: 'date', required: true, help: v.type === 'deposit' ? 'Tip: deposits on or before the 5th earn interest for that month.' : '' },
        { name: 'fromAccount', label: v.type === 'deposit' ? 'Paid from (also records an expense entry)' : 'Credited to (also records an income entry)', type: 'select', options: accOpts },
        { name: 'note', label: 'Note', placeholder: 'Optional' },
      ],
      onSave: (v) => {
        const amount = num(v.amount);
        if (!(amount > 0)) return 'Enter an amount';
        if (!v.date) return 'Choose a date';
        if (v.type === 'deposit') {
          const fy = fyOf(parseDate(v.date));
          const fyS = iso(new Date(fy, 3, 1)), fyE = iso(new Date(fy + 1, 2, 31));
          const other = (p.deposits || []).filter((x) => x.type !== 'withdrawal' && x.date >= fyS && x.date <= fyE && (!d || x.id !== d.id)).reduce((s, x) => s + num(x.amount), 0);
          if (other + amount > PPF_LIMIT && !confirm(`This takes ${fyLabel(fy)} deposits to ${fmt(other + amount)}, above the ₹1,50,000 yearly limit. Excess earns no interest. Save anyway?`)) return false;
        }
        const rec = { id: d ? d.id : uid(), type: v.type, amount, date: v.date, note: (v.note || '').trim(), txnId: d ? d.txnId || '' : '' };
        // Keep the linked income/expense entry in step
        const name = `PPF ${v.type === 'deposit' ? 'deposit' : 'withdrawal'}${p.holder ? ' — ' + p.holder : ''}`;
        if (v.fromAccount) {
          const tx = { type: v.type === 'deposit' ? 'expense' : 'income', amount, accountId: v.fromAccount, toAccountId: '', category: v.type === 'deposit' ? 'Investment' : 'Other', mode: v.type === 'deposit' ? 'bank' : 'bank', note: name, date: v.date };
          const existing = rec.txnId && S.transactions.find((t) => t.id === rec.txnId);
          if (existing) Object.assign(existing, tx);
          else { rec.txnId = uid(); S.transactions.push({ id: rec.txnId, created: new Date().toISOString(), ...tx }); }
        } else if (rec.txnId) { S.transactions = S.transactions.filter((t) => t.id !== rec.txnId); rec.txnId = ''; }
        p.deposits = (p.deposits || []).filter((x) => x.id !== rec.id).concat(rec);
        save(); toast('Saved'); return true;
      },
      onDelete: d ? () => {
        if (!confirm('Delete this PPF transaction?' + (d.txnId ? ' The linked account entry will also be removed.' : ''))) return false;
        p.deposits = p.deposits.filter((x) => x.id !== d.id);
        if (d.txnId) S.transactions = S.transactions.filter((t) => t.id !== d.txnId);
        save(); return true;
      } : null,
    });
  }

  function viewInvest() {
    const t = st.investTab || 'fd';
    const tabs = `<div class="tabs" style="margin-bottom:14px">${[['fd', 'FDs'], ['ppf', 'PPF'], ['ins', 'Insurance'], ['goals', 'Goals'], ['assets', 'Assets & Loans']].map(([k, l]) => `<button class="${t === k ? 'on' : ''}" data-act="invest-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    return tabs + (t === 'ppf' ? viewPpf() : t === 'ins' ? viewInsurance() : t === 'goals' ? viewGoals() : t === 'assets' ? viewAssets() : viewFds());
  }

  // ---------- Documents ----------
  const FileStore = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('acctmgr-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction('files', mode); const req = fn(tx.objectStore('files'));
        tx.oncomplete = () => res(req ? req.result : undefined); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
    };
    return {
      get: (k) => run('readonly', (s) => s.get(k)),
      put: (k, v) => run('readwrite', (s) => s.put(v, k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
      keys: () => run('readonly', (s) => s.getAllKeys()),
      clear: () => run('readwrite', (s) => s.clear()),
    };
  })();

  const docIcon = (d) => /pdf/.test(d.mime) ? '📕' : /^image\//.test(d.mime) ? '🖼️' : /sheet|excel|csv/.test(d.mime) ? '📊' : /word|document|text/.test(d.mime) ? '📝' : '📎';
  const docFileName = (d) => {
    const ext = (d.fileName || '').match(/\.[A-Za-z0-9]{1,5}$/);
    return (d.name || 'document').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + (ext ? ext[0] : '');
  };

  async function maybeCompress(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const sc = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (blob && blob.size < file.size) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) { console.warn('compress failed', e); }
    return file;
  }

  async function addDocuments(files, meta) {
    let n = 0; const ids = [];
    for (const f0 of files) {
      if (f0.size > MAX_FILE) { alert(`“${f0.name}” is ${fmtSize(f0.size)}. The limit is 15 MB per file.`); continue; }
      const f = meta.compress ? await maybeCompress(f0) : f0;
      const buf = new Uint8Array(await f.arrayBuffer());
      const id = uid();
      await FileStore.put(id, { buf: buf.buffer, type: f.type });
      const doc = {
        id, name: files.length === 1 && meta.name ? meta.name : f0.name.replace(/\.[^.]+$/, ''), category: meta.category || 'Other',
        fileName: f.name, mime: f.type || 'application/octet-stream', size: buf.length, chunks: Math.max(1, Math.ceil(buf.length / CHUNK)),
        added: iso(), expiry: meta.expiry || '', notes: meta.notes || '', cloud: false,
      };
      if (meta.txnId) doc.txnId = meta.txnId;
      ids.push(id);
      if (signedIn()) { doc.cloud = true; Cloud.uploadFile(id, buf, CHUNK).catch((e) => toast('Upload failed: ' + e.message)); }
      S.documents.push(doc); n++;
    }
    if (n) { save(); render(); if (!meta.quiet) toast(n > 1 ? `${n} documents saved` : 'Document saved'); }
    return ids;
  }

  async function uploadPendingFiles() {
    if (!signedIn()) return;
    let changed = false;
    for (const d of S.documents) {
      if (d.cloud) continue;
      const rec = await FileStore.get(d.id).catch(() => null);
      if (!rec) continue;
      Cloud.uploadFile(d.id, new Uint8Array(rec.buf), CHUNK).catch((e) => toast('Upload failed: ' + e.message));
      d.cloud = true; changed = true;
    }
    if (changed) save();
  }

  function removeDocFiles(d) {
    FileStore.del(d.id).catch(() => {});
    if (signedIn() && d.cloud) Cloud.deleteFile(d.id, d.chunks);
  }

  async function getFileBlob(d) {
    let rec = await FileStore.get(d.id).catch(() => null);
    if (!rec) {
      if (!signedIn()) throw new Error('This file is not saved on this device. Sign in to Cloud Sync to download it.');
      const u8 = await Cloud.downloadFile(d.id, d.chunks);
      rec = { buf: u8.buffer, type: d.mime };
      FileStore.put(d.id, rec).catch(() => {});
    }
    return new Blob([rec.buf], { type: rec.type || d.mime });
  }

  const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  async function writeCache(blob, d) {
    const Filesystem = plugin('Filesystem');
    return (await Filesystem.writeFile({ path: 'docs/' + docFileName(d), data: await blobToBase64(blob), directory: 'CACHE', recursive: true })).uri;
  }
  async function openBlob(blob, d) {
    if (native()) {
      try {
        const uri = await writeCache(blob, d);
        const opener = plugin('FileOpener');
        if (opener) { await opener.open({ filePath: uri, contentType: d.mime, openWithDefault: true }); return; }
        await plugin('Share').share({ files: [uri], title: d.name });
      } catch (e) { if (!/cancel/i.test(e && e.message)) alert('Could not open: ' + (e.message || e) + '\nYou may need an app that opens this file type (e.g. a PDF viewer).'); }
      return;
    }
    window.open(URL.createObjectURL(blob), '_blank');
  }
  async function saveBlob(blob, d) {
    if (native()) {
      try {
        const Filesystem = plugin('Filesystem');
        try { await Filesystem.requestPermissions(); } catch {}
        await Filesystem.writeFile({ path: 'AccountManager/' + docFileName(d), data: await blobToBase64(blob), directory: 'DOCUMENTS', recursive: true });
        toast('Saved to Documents/AccountManager');
      } catch (e) { console.warn(e); shareBlob(blob, d); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = docFileName(d);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function shareBlob(blob, d) {
    try {
      if (native()) { await plugin('Share').share({ files: [await writeCache(blob, d)], title: d.name, dialogTitle: 'Share or save' }); return; }
      const file = new File([blob], docFileName(d), { type: d.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: d.name }); return; }
      saveBlob(blob, d);
    } catch (e) { if (!/cancel|abort/i.test(e && (e.message || e.name))) alert('Could not share: ' + (e.message || e)); }
  }

  async function openDocument(d) {
    const m = modal(d.name);
    const exp = d.expiry ? daysBetween(new Date(new Date().toDateString()), parseDate(d.expiry)) : null;
    m.body.innerHTML = `<div class="doc-preview"><div class="empty">Loading…</div></div>
      <div class="btn-row" style="margin:12px 0"><button class="btn primary" data-d="open">Open</button><button class="btn" data-d="save">Download</button><button class="btn" data-d="share">Share</button></div>
      <div class="card" style="margin-bottom:12px">${kv('Category', d.category)}${kv('File', d.fileName)}${kv('Size', fmtSize(d.size))}${kv('Added', fmtDate(d.added))}
      ${d.expiry ? kv('Expiry', `${fmtDate(d.expiry)}${exp < 0 ? ' (expired)' : exp <= 60 ? ` (${exp} days left)` : ''}`) : ''}${kv('Notes', d.notes)}
      ${kv('Stored', d.cloud ? 'Cloud + this device' : 'This device only')}</div>
      ${/pdf|^image\//.test(d.mime) ? '<button class="btn block" style="margin-bottom:10px" data-d="scan">✨ Read details → create FD / policy</button>' : ''}
      <div class="btn-row"><button class="btn" data-d="edit">Edit details</button><button class="btn danger" data-d="delete">Delete</button></div>`;
    let blob = null;
    const pv = $('.doc-preview', m.body);
    try {
      blob = await getFileBlob(d);
      const url = URL.createObjectURL(blob);
      const touch = matchMedia('(pointer: coarse)').matches;
      if (/^image\//.test(d.mime)) pv.innerHTML = `<img src="${url}" alt="${esc(d.name)}">`;
      else if (/pdf/.test(d.mime) && !native() && !touch) pv.innerHTML = `<iframe src="${url}" title="PDF preview"></iframe>`;
      else pv.innerHTML = `<div class="empty"><div class="em">${docIcon(d)}</div>${esc(d.fileName)}<br><span class="small">Tap “Open” to view.</span></div>`;
    } catch (e) { pv.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
    m.body.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-d]'); if (!b) return;
      const a = b.dataset.d;
      if (a === 'edit') { m.close(); docForm(d); return; }
      if (a === 'delete') {
        if (!confirm(`Delete “${d.name}”?${signedIn() ? ' It will be removed from all your devices.' : ''}`)) return;
        deleteDocument(d); save(); m.close(); render(); toast('Document deleted'); return;
      }
      if (!blob) return toast('File not available');
      if (a === 'scan') { m.close(); scanDocument(new File([blob], d.fileName || 'document', { type: d.mime }), { docId: d.id, docName: d.name }); return; }
      if (a === 'open') openBlob(blob, d); else if (a === 'save') saveBlob(blob, d); else shareBlob(blob, d);
    });
  }

  function docForm(d) {
    const cats = [...new Set([...DOC_CATS, ...S.documents.map((x) => x.category)])];
    openForm({
      title: d ? 'Edit document' : 'Add documents',
      values: d ? { ...d } : { category: st.docCat || '', compress: true, scan: true },
      fields: () => [
        ...(d ? [] : [
          { name: 'files', label: 'Choose files (PDF, photos, etc.)', type: 'file', multiple: true, accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt' },
          { name: 'photo', label: 'Or take a photo', type: 'file', accept: 'image/*', capture: 'environment' },
        ]),
        { name: 'name', label: d ? 'Name' : 'Name (optional)', placeholder: d ? '' : 'Uses the file name if blank, e.g. “PAN Card”' },
        { name: 'category', label: 'Category', type: 'list', options: cats, placeholder: 'e.g. ID Proofs' },
        { name: 'expiry', label: 'Expiry / renewal date (optional)', type: 'date', help: 'Passport, insurance, PUC, licence… you’ll get a reminder on Home.' },
        { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Policy no., document no., where the original is kept…' },
        ...(d ? [] : [{ name: 'compress', label: 'Reduce size of large photos (recommended)', type: 'checkbox' },
          { name: 'scan', label: '✨ Read the document: fill in FD / insurance details automatically and make its text searchable', type: 'checkbox' }]),
      ],
      onSave: (v) => {
        if (d) {
          if (!v.name.trim()) return 'Enter a name';
          Object.assign(d, { name: v.name.trim(), category: (v.category || '').trim() || 'Other', expiry: v.expiry || '', notes: (v.notes || '').trim() });
          save(); toast('Saved'); return true;
        }
        const files = [...(v.files || []), ...(v.photo || [])];
        if (!files.length) return 'Choose a file or take a photo';
        addDocuments(files, { name: (v.name || '').trim(), category: (v.category || '').trim() || 'Other', expiry: v.expiry, notes: (v.notes || '').trim(), compress: !!v.compress })
          .then((ids) => {
            if (!v.scan || files.length !== 1 || !ids[0] || !/pdf|^image\//.test(files[0].type)) return;
            const doc = S.documents.find((x) => x.id === ids[0]);
            scanDocument(files[0], { docId: ids[0], docName: doc ? doc.name : '', quiet: true });
          })
          .catch((e) => alert('Could not save: ' + e.message));
        toast('Saving…');
        return true;
      },
      onDelete: d ? () => {
        if (!confirm(`Delete “${d.name}”?`)) return false;
        deleteDocument(d); save(); return true;
      } : null,
    });
  }

  let orphanCheckDone = false;
  function viewDocs() {
    if (!orphanCheckDone) { // tidy up files whose document was deleted on another device
      orphanCheckDone = true;
      FileStore.keys().then((keys) => { const ids = new Set(S.documents.map((d) => d.id)); keys.filter((k) => !ids.has(k)).forEach((k) => FileStore.del(k)); }).catch(() => {});
    }
    const q = (st.filter.docq || '').toLowerCase(), cat = st.docCat || '';
    let list = S.documents;
    if (cat) list = list.filter((d) => d.category === cat);
    if (q) list = list.filter((d) => [d.name, d.category, d.notes, d.fileName, d.text].join(' ').toLowerCase().includes(q));
    const cats = [...new Set(S.documents.map((d) => d.category))].sort();
    const total = S.documents.reduce((s, d) => s + num(d.size), 0);
    const today = new Date(new Date().toDateString());
    const groups = {};
    [...list].sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => { (groups[d.category] = groups[d.category] || []).push(d); });
    let html = !signedIn() ? `<div class="notice">📱 <div class="grow">Documents are saved only on this device. Sign in to Cloud Sync to keep them safe and open them on the website too.</div><button class="link" data-act="open" data-kind="cloud">Sign in</button></div>` : '';
    html += `<div class="row" style="margin-bottom:12px"><div class="grow"><b>${S.documents.length}</b> <span class="muted">document${S.documents.length === 1 ? '' : 's'} · ${fmtSize(total)}</span></div><button class="btn primary" data-act="add-doc">+ Upload</button></div>`;
    if (S.documents.length) {
      html += `<div class="filters" style="grid-template-columns:1fr"><input type="search" data-filter="docq" placeholder="Search documents…" value="${esc(st.filter.docq || '')}"></div>
        <div class="chips scroll-x" style="margin-bottom:12px"><button class="chip-btn ${!cat ? 'on' : ''}" data-act="doc-cat" data-v="">All</button>${cats.map((c) => `<button class="chip-btn ${cat === c ? 'on' : ''}" data-act="doc-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
    }
    const keys = Object.keys(groups).sort();
    if (!keys.length) {
      html += `<div class="list"><div class="empty"><div class="em">🗂️</div>${S.documents.length ? 'No documents match.' : 'Keep Aadhaar, PAN, passport, insurance policies, property papers, RC, ITR and more in one place.<br><span class="small">Tap “+ Upload” to add PDFs or photos.</span>'}</div></div>`;
    }
    for (const k of keys) {
      html += `<div class="section-title">${esc(k)}</div><div class="list">${groups[k].map((d) => {
        const e = d.expiry ? daysBetween(today, parseDate(d.expiry)) : null;
        const badge = e === null ? '' : e < 0 ? '<span class="badge warn">Expired</span>' : e <= 60 ? `<span class="badge warn">Expires in ${e}d</span>` : '';
        return `<button class="item" data-act="open-doc" data-id="${d.id}"><div class="avatar">${docIcon(d)}</div>
          <div class="grow"><div class="title ellipsis">${esc(d.name)}</div><div class="sub ellipsis">${badge ? badge + ' ' : ''}${fmtSize(d.size)} · ${fmtDate(d.added)}${d.cloud ? ' · ☁️' : ''}</div></div>${ICON.chev}</button>`;
      }).join('')}</div>`;
    }
    return html;
  }

  // ---------- Reminders ----------
  function reminders() {
    const out = [];
    const today = new Date(new Date().toDateString());
    S.fds.filter((f) => f.status !== 'closed').forEach((f) => {
      const c = fdCalc(f);
      if (c.daysLeft <= 45) out.push({ days: c.daysLeft, icon: '🔒', title: `${f.bank} FD ${c.daysLeft < 0 ? 'matured' : c.daysLeft === 0 ? 'matures today' : 'matures in ' + c.daysLeft + 'd'}`, sub: `${fmtDate(c.matISO)} · ${fmt(c.maturity)}`, act: 'edit-fd', id: f.id });
    });
    S.documents.filter((d) => d.expiry).forEach((d) => {
      const e = daysBetween(today, parseDate(d.expiry));
      if (e <= 60) out.push({ days: e, icon: '📄', title: `${d.name} ${e < 0 ? 'expired' : 'expires in ' + e + 'd'}`, sub: fmtDate(d.expiry), act: 'open-doc', id: d.id });
    });
    const b = balances();
    S.accounts.filter((a) => a.type === 'credit' && num(a.dueDay) >= 1 && !a.archived).forEach((a) => {
      const cyc = cardCycle(a);
      if (cyc) {
        if (cyc.remaining > 0 && cyc.daysToDue !== null && cyc.daysToDue <= 7) out.push({ days: cyc.daysToDue, icon: '💳', title: `${a.name}: pay ${fmt(cyc.remaining)} ${cyc.daysToDue < 0 ? '(overdue)' : cyc.daysToDue === 0 ? 'today' : 'in ' + cyc.daysToDue + 'd'}`, sub: `Due ${fmtDate(cyc.dueISO)} · statement ${fmtDate(cyc.lastISO)}`, act: 'open-account', id: a.id });
        return;
      }
      const dd = Math.min(31, num(a.dueDay));
      const mk = (y, m) => new Date(y, m, Math.min(dd, new Date(y, m + 1, 0).getDate()));
      let due = mk(today.getFullYear(), today.getMonth());
      if (due < today) due = mk(today.getFullYear(), today.getMonth() + 1);
      const days = daysBetween(today, due);
      const owed = -(b[a.id] || 0);
      if (days <= 7 && owed > 0) out.push({ days, icon: '💳', title: `${a.name} bill due ${days === 0 ? 'today' : 'in ' + days + 'd'}`, sub: `${fmtDate(iso(due))} · outstanding ${fmt(owed)}`, act: 'open-account', id: a.id });
    });
    S.ppf.filter((p) => p.status !== 'closed').forEach((p) => {
      const c = ppfCalc(p);
      const m = today.getMonth();
      const marchEnd = new Date(c.fy + 1, 2, 31);
      if (m <= 2 && c.fyDeposited < 500) out.push({ days: daysBetween(today, marchEnd), icon: '🏛️', title: `PPF${p.holder ? ' (' + p.holder + ')' : ''}: deposit before 31 Mar`, sub: 'Minimum ₹500 a year keeps the account active', act: 'open-ppf', id: p.id });
      else if (m >= 1 && m <= 2 && c.fyLeft > 0 && c.plan > c.fyDeposited) out.push({ days: daysBetween(today, marchEnd), icon: '🏛️', title: `PPF${p.holder ? ' (' + p.holder + ')' : ''}: ${fmt(c.fyLeft)} limit left this FY`, sub: 'Invest before 31 Mar for 80C', act: 'open-ppf', id: p.id });
      if (c.daysLeft >= 0 && c.daysLeft <= 90) out.push({ days: c.daysLeft, icon: '🏛️', title: `PPF${p.holder ? ' (' + p.holder + ')' : ''} matures in ${c.daysLeft}d`, sub: 'Decide: withdraw or extend for 5 years', act: 'open-ppf', id: p.id });
    });
    S.bills.filter((x) => x.active && x.nextDue).forEach((x) => {
      const dd = daysBetween(today, parseDate(x.nextDue));
      if (dd <= 5) out.push({ days: dd, icon: billIcon(x), title: `${x.name} ${x.autoPay ? 'auto-debit' : 'bill'} ${dd < 0 ? 'overdue' : dd === 0 ? 'due today' : 'due in ' + dd + 'd'}`, sub: `${fmtDate(x.nextDue)}${billTypical(x) ? ' · ' + fmt(billTypical(x)) : ''}`, act: x.autoPay ? 'edit-bill' : 'pay-bill', id: x.id });
    });
    S.warranties.forEach((w) => {
      const e = warrantyEnd(w); if (!e) return;
      const dd = daysBetween(today, parseDate(e));
      if (dd >= -3 && dd <= 30) out.push({ days: dd, icon: '📦', title: `${w.product} warranty ${dd < 0 ? 'ended' : 'ends in ' + dd + 'd'}`, sub: fmtDate(e) + ' · get it checked before it ends', act: 'edit-warranty', id: w.id });
    });
    S.vehicles.forEach((v) => vehicleDues(v).forEach((d) => {
      if (d.policyId) return; // shown with insurance policies
      if (d.days <= 15) out.push({ days: d.km !== undefined ? 3 : d.days, icon: VEH_TYPES[v.type] || '🚗', title: `${v.name}: ${d.k} ${d.km !== undefined ? (d.km <= 0 ? 'due now' : 'in ' + d.km + ' km') : d.days < 0 ? 'overdue' : d.days === 0 ? 'due today' : 'due in ' + d.days + 'd'}`, sub: d.date ? fmtDate(d.date) : `at ${num(v.serviceDueKm).toLocaleString('en-IN')} km`, act: 'open-vehicle', id: v.id });
    }));
    S.policies.filter(policyActive).forEach((p) => {
      const nm = p.insurer || (POLICY_TYPES[p.type] || POLICY_TYPES.other)[0];
      if (p.nextDue && p.frequency !== 'single') {
        const dd = daysBetween(today, parseDate(p.nextDue));
        if (dd <= 30) out.push({ days: dd, icon: '🛡️', title: `${nm} premium ${dd < 0 ? 'overdue' : dd === 0 ? 'due today' : 'due in ' + dd + 'd'}`, sub: `${fmtDate(p.nextDue)} · ${fmt(p.premium)}`, act: 'open-policy', id: p.id });
      } else if (p.endDate) {
        const dd = daysBetween(today, parseDate(p.endDate));
        if (dd <= 30) out.push({ days: dd, icon: '🛡️', title: `${nm} policy ends in ${dd}d`, sub: fmtDate(p.endDate) + ' · renew if needed', act: 'open-policy', id: p.id });
      }
    });
    return out.sort((a, b) => a.days - b.days);
  }

  // ---------- PIN lock (per device, not synced) ----------
  const PIN_KEY = 'acctmgr.pin';
  const pinData = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch { return null; } };
  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ':' + pin);
    if (window.crypto && crypto.subtle) {
      const h = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    let h = 7; data.forEach((c) => { h = (h * 31 + c) | 0; }); return 'x' + h;
  }
  async function setPin(pin) { const salt = uid(); localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await hashPin(pin, salt), after: (pinData() || {}).after ?? 30 })); }
  async function checkPin(pin) { const p = pinData(); return !!p && (await hashPin(pin, p.salt)) === p.hash; }

  function showLock() {
    if (!pinData() || $('#lock')) return;
    const el = document.createElement('div');
    el.id = 'lock';
    el.innerHTML = `<div class="lock-box"><div class="lock-logo">🔐</div><h2>Enter PIN</h2><div class="pin-dots"><i></i><i></i><i></i><i></i></div><div class="pin-err"></div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => `<button type="button" data-k="${k}" ${k === '' ? 'disabled class="ghost"' : ''}>${k}</button>`).join('')}</div>
      <button type="button" class="link" data-k="forgot" style="margin-top:14px">Forgot PIN?</button></div>`;
    document.body.appendChild(el);
    let entered = '';
    const dots = () => el.querySelectorAll('.pin-dots i').forEach((d, i) => d.classList.toggle('on', i < entered.length));
    const press = async (k) => {
      if (k === 'forgot') return forgotPin();
      if (k === '⌫') entered = entered.slice(0, -1);
      else if (/^\d$/.test(k) && entered.length < 4) entered += k;
      dots();
      if (entered.length === 4) {
        const ok = await checkPin(entered);
        if (ok) { el.remove(); document.removeEventListener('keydown', onKey, true); }
        else { el.querySelector('.pin-err').textContent = 'Wrong PIN'; el.querySelector('.pin-dots').classList.add('shake'); setTimeout(() => { entered = ''; dots(); el.querySelector('.pin-dots').classList.remove('shake'); }, 450); }
      }
    };
    const onKey = (e) => { if (!$('#lock')) return; if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); e.stopPropagation(); };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) press(b.dataset.k); });
  }
  async function forgotPin() {
    if (signedIn()) {
      if (!confirm('Reset PIN by signing out?\n\nYour data stays safe in the cloud. Sign in again with your email and password to get it back.')) return;
      try { await Cloud.signOut(); await FileStore.clear().catch(() => {}); } catch (e) { return alert(e.message); }
    } else {
      if (!confirm('You are not signed in to Cloud Sync, so the only way to reset the PIN is to ERASE all data on this device. Continue?')) return;
      if (!confirm('Really erase everything on this device?')) return;
      S = defaultData(); saveLocal(); await FileStore.clear().catch(() => {});
    }
    localStorage.removeItem(PIN_KEY);
    const l = $('#lock'); if (l) l.remove();
    st.sub = null; st.tab = 'home'; render();
  }
  let hiddenAt = 0;
  function onAppHidden() { hiddenAt = Date.now(); }
  function onAppVisible() {
    const p = pinData();
    if (p && hiddenAt && Date.now() - hiddenAt >= (num(p.after) * 1000)) showLock();
    hiddenAt = 0;
    if (runRecurring()) render();
  }
  function pinForm(mode) {
    const p = pinData();
    openForm({
      title: mode === 'remove' ? 'Remove PIN' : p ? 'Change PIN' : 'Set app PIN',
      values: { after: p ? p.after ?? 30 : 30 },
      fields: () => [
        ...(p ? [{ name: 'cur', label: 'Current PIN', type: 'password', max: 4, inputmode: 'numeric' }] : []),
        ...(mode === 'remove' ? [] : [
          { name: 'pin', label: 'New 4-digit PIN', type: 'password', max: 4, inputmode: 'numeric' },
          { name: 'pin2', label: 'Confirm new PIN', type: 'password', max: 4, inputmode: 'numeric' },
          { name: 'after', label: 'Lock again when the app is in the background for', type: 'select', options: [[0, 'Immediately'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']] },
        ]),
      ],
      onSave: (v) => {
        if (mode !== 'remove') {
          if (!/^\d{4}$/.test(v.pin || '')) return 'PIN must be exactly 4 digits';
          if (v.pin !== v.pin2) return 'PINs do not match';
        }
        (async () => {
          if (p && !(await checkPin(v.cur || ''))) return alert('Current PIN is wrong — nothing was changed.');
          if (mode === 'remove') { localStorage.removeItem(PIN_KEY); toast('PIN removed'); render(); return; }
          await setPin(v.pin);
          const d = pinData(); d.after = num(v.after); localStorage.setItem(PIN_KEY, JSON.stringify(d));
          toast('PIN set — the app will ask for it when opened'); render();
        })();
        return true;
      },
    });
  }

  // =====================================================================
  // v1.4: insurance, savings goals, receipts, emergency sheet, SMS inbox
  // =====================================================================
  const today0 = () => new Date(new Date().toDateString());

  function deleteDocument(d) {
    removeDocFiles(d);
    S.documents = S.documents.filter((x) => x.id !== d.id);
    S.transactions.forEach((t) => { if (t.receiptId === d.id) delete t.receiptId; });
    S.policies.forEach((p) => { if (p.linkedDocId === d.id) p.linkedDocId = ''; });
  }

  // ---------- Insurance ----------
  const POLICY_TYPES = {
    term: ['Term life', '🛡️'], life: ['Life / Endowment / ULIP', '👨‍👩‍👧'], health: ['Health', '🏥'], vehicle: ['Vehicle', '🚗'],
    home: ['Home', '🏠'], accident: ['Personal accident', '🩹'], travel: ['Travel', '✈️'], other: ['Other', '📋'],
  };
  const PREM_FREQ = [['yearly', 'Yearly', 12], ['half-yearly', 'Half-yearly', 6], ['quarterly', 'Quarterly', 3], ['monthly', 'Monthly', 1], ['single', 'Single / one-time', 0]];
  const freqMonths = (f) => (PREM_FREQ.find((x) => x[0] === f) || PREM_FREQ[0])[2];
  const freqLabel = (f) => (PREM_FREQ.find((x) => x[0] === f) || PREM_FREQ[0])[1];
  const yearlyPremium = (p) => { const m = freqMonths(p.frequency); return m ? (num(p.premium) * 12) / m : 0; };
  const policyActive = (p) => p.status !== 'lapsed' && p.status !== 'ended' && !(p.endDate && p.endDate < iso());
  const INSURERS = ['LIC', 'HDFC Life', 'ICICI Prudential', 'SBI Life', 'Max Life', 'Tata AIA', 'Bajaj Allianz', 'Star Health', 'Niva Bupa', 'Care Health', 'HDFC ERGO', 'ICICI Lombard', 'Tata AIG', 'Digit', 'Acko', 'New India Assurance'];

  function policyBadge(p) {
    if (p.status === 'lapsed') return '<span class="badge">Lapsed</span>';
    if (!policyActive(p)) return '<span class="badge">Ended</span>';
    if (p.nextDue && p.frequency !== 'single') {
      const d = daysBetween(today0(), parseDate(p.nextDue));
      if (d < 0) return `<span class="badge warn">Overdue ${-d}d</span>`;
      if (d <= 30) return `<span class="badge warn">Due in ${d}d</span>`;
    }
    if (p.endDate) { const d = daysBetween(today0(), parseDate(p.endDate)); if (d <= 30) return `<span class="badge warn">Ends in ${d}d</span>`; }
    return '<span class="badge ok">Active</span>';
  }
  function policyItem(p) {
    const [label, icon] = POLICY_TYPES[p.type] || POLICY_TYPES.other;
    return `<button class="item" data-act="open-policy" data-id="${p.id}"><div class="avatar">${icon}</div>
      <div class="grow"><div class="title ellipsis">${esc(p.insurer || label)}${p.planName ? ' · ' + esc(p.planName) : ''}</div>
      <div class="sub ellipsis">${policyBadge(p)} ${esc(label)}${p.insured ? ' · ' + esc(p.insured) : ''}</div></div>
      <div class="right"><b>${money(p.sumAssured)}</b><div class="sub">${p.frequency === 'single' ? 'single premium' : p.nextDue ? 'next ' + fmtDate(p.nextDue) : ''}</div></div></button>`;
  }
  function viewInsurance() {
    const act = S.policies.filter(policyActive);
    const cover = (types) => act.filter((p) => types.includes(p.type)).reduce((s, p) => s + num(p.sumAssured), 0);
    const prem = act.reduce((s, p) => s + yearlyPremium(p), 0);
    const list = [...S.policies].sort((a, b) => (policyActive(b) - policyActive(a)) || (a.nextDue || '9').localeCompare(b.nextDue || '9'));
    return `<div class="card hero"><div class="label">Life cover</div><div class="big amt">${esc(fmt(cover(['term', 'life'])))}</div>
      <div class="split"><div><small>Health cover</small><b class="amt">${esc(fmt(cover(['health'])))}</b></div><div><small>Premiums per year</small><b class="amt">${esc(fmt(prem))}</b></div></div></div>
      <div class="row" style="margin-bottom:12px"><div class="grow small muted">${act.length} active polic${act.length === 1 ? 'y' : 'ies'}</div><button class="btn primary" data-act="add-policy">+ Policy</button></div>
      ${list.length ? `<div class="list">${list.map(policyItem).join('')}</div>`
        : '<div class="list"><div class="empty"><div class="em">🛡️</div>Add term, health, vehicle and other policies to get premium reminders and a full picture of your cover.</div></div>'}`;
  }
  function viewPolicy(id) {
    const p = S.policies.find((x) => x.id === id);
    if (!p) { st.sub = null; return viewInvest(); }
    const [label, icon] = POLICY_TYPES[p.type] || POLICY_TYPES.other;
    const paid = S.transactions.filter((t) => t.policyId === p.id).sort((a, b) => b.date.localeCompare(a.date));
    const doc = p.linkedDocId && S.documents.find((d) => d.id === p.linkedDocId);
    const revKey = 'pol' + p.id;
    return `<div class="card hero"><div class="row"><div class="avatar" style="background:rgba(255,255,255,.15)">${icon}</div><div class="grow"><div class="label">${esc(p.insurer || '')} · ${esc(label)}</div></div></div>
      <div class="big amt">${esc(fmt(p.sumAssured))}</div>
      <div class="split"><div><small>Premium</small><b class="amt">${p.frequency === 'single' ? 'Single' : esc(fmt(p.premium)) + ' / ' + esc(freqLabel(p.frequency).toLowerCase())}</b></div><div><small>Next due</small><b>${p.nextDue && p.frequency !== 'single' ? fmtDate(p.nextDue) : '—'}</b></div></div></div>
      <div class="btn-row" style="margin-bottom:14px">${p.frequency !== 'single' && policyActive(p) ? `<button class="btn primary" data-act="pay-premium" data-id="${p.id}">✓ Premium paid</button>` : ''}
        <button class="btn" data-act="edit-policy" data-id="${p.id}">Edit details</button>${doc ? `<button class="btn" data-act="open-doc" data-id="${doc.id}">📄 Policy doc</button>` : ''}</div>
      <div class="card"><h2>Details ${policyBadge(p)}</h2>
        ${kv('Plan', p.planName)}
        ${kv('Policy number', p.policyNumber ? (st.reveal[revKey] ? p.policyNumber : mask(p.policyNumber)) : '', { reveal: p.policyNumber ? revKey : null, copy: p.policyNumber })}
        ${kv('Insured', p.insured)}
        ${kv('Vehicle number', p.vehicleNumber)}
        ${kv('Start date', p.startDate ? fmtDate(p.startDate) : '')}
        ${kv(p.type === 'life' ? 'Maturity date' : 'End / renewal date', p.endDate ? fmtDate(p.endDate) : '')}
        ${kv('Current fund / surrender value', num(p.value) ? money(p.value) : '', { html: true })}
        ${kv('Nominee', p.nominee)}
        ${kv('Agent / advisor', [p.agentName, p.agentPhone].filter(Boolean).join(' · '))}
        ${p.agentPhone ? `<div class="kv"><span></span><span class="val"><a class="link" href="tel:${esc(p.agentPhone.replace(/[^\d+]/g, ''))}">Call agent</a></span></div>` : ''}
        ${kv('Claim helpline', p.helpline, { copy: p.helpline })}
        ${kv('Notes', p.notes)}</div>
      <div class="section-title">Premiums paid (${paid.length})</div>
      ${paid.length ? `<div class="list">${paid.map((t) => txnRow(t)).join('')}</div>` : '<div class="list"><div class="empty">Tap “Premium paid” to record payments here.</div></div>'}`;
  }
  function policyForm(p, opts = {}) {
    openForm({
      title: p ? 'Edit policy' : 'New insurance policy',
      values: p ? { ...p } : { type: 'health', frequency: 'yearly', status: 'active', ...(opts.prefill || {}), ...(opts.docId ? { linkedDocId: opts.docId } : {}) },
      fields: (v) => [
        ...(opts.banner ? [{ name: 'scanInfo', type: 'preview', render: () => opts.banner }] : []),
        { name: 'type', label: 'Type', type: 'select', options: Object.entries(POLICY_TYPES).map(([k, [l, i]]) => [k, `${i} ${l}`]), rerender: true },
        { name: 'insurer', label: 'Insurance company', type: 'list', options: INSURERS, half: true },
        { name: 'planName', label: 'Plan name', half: true, placeholder: 'e.g. Optima Secure' },
        { name: 'policyNumber', label: 'Policy number' },
        { name: 'insured', label: 'Who is covered', placeholder: v.type === 'health' ? 'e.g. Self, Spouse, 2 kids' : 'e.g. Self' },
        ...(v.type === 'vehicle' ? [{ name: 'vehicleNumber', label: 'Vehicle number', placeholder: 'e.g. MH12AB1234' }] : []),
        { name: 'sumAssured', label: v.type === 'vehicle' ? 'IDV (insured value)' : 'Sum assured / cover', type: 'number' },
        { name: 'premium', label: 'Premium amount', type: 'number', half: true },
        { name: 'frequency', label: 'Paid', type: 'select', options: PREM_FREQ.map(([k, l]) => [k, l]), half: true },
        { name: 'nextDue', label: 'Next premium / renewal date', type: 'date', half: true },
        { name: 'startDate', label: 'Start date', type: 'date', half: true },
        { name: 'endDate', label: v.type === 'life' ? 'Maturity date' : 'Policy end date', type: 'date', help: v.type === 'term' ? 'Cover ends at this date (e.g. age 60/65).' : '' },
        ...(v.type === 'life' ? [{ name: 'value', label: 'Current fund / surrender value (optional)', type: 'number', help: 'For ULIP / endowment. Counts in your net worth.' }] : []),
        { name: 'nominee', label: 'Nominee', half: true },
        { name: 'helpline', label: 'Claim helpline', half: true, placeholder: 'e.g. 1800-xxx' },
        { name: 'agentName', label: 'Agent / advisor', half: true },
        { name: 'agentPhone', label: 'Agent phone', type: 'tel', half: true },
        { name: 'linkedDocId', label: 'Policy document (from Docs)', type: 'select', options: [['', S.documents.length ? '— none —' : 'Upload it in the Docs tab first'], ...S.documents.map((d) => [d.id, `${d.name} (${d.category})`])] },
        ...(p ? [{ name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['lapsed', 'Lapsed'], ['ended', 'Ended / surrendered']] }] : []),
        { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Riders, waiting periods, TPA, claim process…' },
      ],
      onSave: (v) => {
        if (!v.insurer && !v.planName) return 'Enter the insurance company';
        const rec = {};
        ['type', 'insurer', 'planName', 'policyNumber', 'insured', 'vehicleNumber', 'frequency', 'nextDue', 'startDate', 'endDate', 'nominee', 'helpline', 'agentName', 'agentPhone', 'linkedDocId', 'notes', 'status'].forEach((k) => { rec[k] = typeof v[k] === 'string' ? v[k].trim() : (v[k] || ''); });
        ['sumAssured', 'premium', 'value'].forEach((k) => { rec[k] = num(v[k]); });
        rec.status = rec.status || 'active';
        if (p) Object.assign(p, rec);
        else { const np = { id: uid(), ...rec }; S.policies.push(np); if (!np.linkedDocId) linkScannedFile(opts, np, 'policy'); }
        save(); toast('Policy saved'); return true;
      },
      extra: !p && !opts.prefill ? [{ label: '📷 Scan policy', act: () => { pickFileThen((file) => scanDocument(file, { hint: 'policy' })); return true; } }] : [],
      onDelete: p ? () => { if (!confirm('Delete this policy? Recorded premium entries are kept.')) return false; S.policies = S.policies.filter((x) => x.id !== p.id); save(); st.sub = null; return true; } : null,
    });
  }
  function premiumForm(p) {
    const accs = S.accounts.filter((a) => !a.archived);
    openForm({
      title: 'Record premium payment',
      values: { amount: p.premium || '', date: iso(), accountId: (accs.find((a) => a.type === 'bank') || accs[0] || {}).id || '', mode: 'upi', _touched_mode: true },
      fields: (v) => [
        { name: 'amount', label: 'Amount paid', type: 'number', big: true },
        { name: 'date', label: 'Paid on', type: 'date', half: true },
        { name: 'accountId', label: 'Paid from', type: 'select', half: true, options: accs.map((a) => [a.id, `${accIcon(a)} ${a.name}`]) },
        { name: 'mode', label: 'Paid by', type: 'segment', options: PAY_MODES },
        { name: 'info', type: 'preview', render: () => `<span class="small">Adds an “Insurance” expense and moves the next due date from ${p.nextDue ? fmtDate(p.nextDue) : '—'} to <b>${fmtDate(iso(addTenure(parseDate(p.nextDue || v.date), freqMonths(p.frequency), 0)))}</b>.</span>` },
      ],
      onSave: (v) => {
        if (!(num(v.amount) > 0)) return 'Enter the amount';
        if (!v.accountId) return 'Choose an account';
        S.transactions.push({ id: uid(), type: 'expense', amount: num(v.amount), accountId: v.accountId, toAccountId: '', category: 'Insurance', mode: v.mode || '', note: `${p.insurer || 'Insurance'} premium${p.policyNumber ? ' (' + p.policyNumber + ')' : ''}`, date: v.date, created: new Date().toISOString(), policyId: p.id });
        p.nextDue = iso(addTenure(parseDate(p.nextDue || v.date), freqMonths(p.frequency), 0));
        p.lastPaid = v.date;
        save(); toast('Premium recorded'); return true;
      },
    });
  }

  // ---------- Savings goals ----------
  const GOAL_ICONS = ['🛟', '🏠', '🚗', '✈️', '🎓', '💍', '👶', '📱', '🏖️', '🏥', '🎯'];
  function goalCalc(g, bal) {
    const saved = Math.max(0, g.linkedAccountId ? (bal || balances())[g.linkedAccountId] || 0
      : num(g.startAmount) + (g.contributions || []).reduce((s, c) => s + (c.type === 'withdraw' ? -1 : 1) * num(c.amount), 0));
    const target = num(g.target);
    const p = target ? Math.min(1, saved / target) : 0;
    let monthly = 0, monthsLeft = null;
    if (g.targetDate) {
      const t = parseDate(g.targetDate), n = today0();
      monthsLeft = Math.max(0, (t.getFullYear() - n.getFullYear()) * 12 + t.getMonth() - n.getMonth());
      monthly = Math.max(0, target - saved) / Math.max(1, monthsLeft);
    }
    return { saved, target, p, monthly, monthsLeft, done: target > 0 && saved >= target };
  }
  function goalLine(g, c) {
    if (c.done) return '🎉 Goal reached!';
    if (g.targetDate) return c.monthsLeft > 0 ? `Save ${fmt(c.monthly)}/month to reach it by ${fmtDate(g.targetDate)}` : `Target date passed · ${fmt(c.target - c.saved)} to go`;
    return `${fmt(c.target - c.saved)} to go`;
  }
  function goalItem(g, bal) {
    const c = goalCalc(g, bal);
    return `<button class="item" data-act="open-goal" data-id="${g.id}" style="flex-wrap:wrap"><div class="avatar">${g.icon || '🎯'}</div>
      <div class="grow"><div class="title ellipsis">${esc(g.name)}</div><div class="sub ellipsis amt">${esc(goalLine(g, c))}</div></div>
      <div class="right"><b>${Math.round(c.p * 100)}%</b><div class="sub amt">${esc(compact(c.saved))} / ${esc(compact(c.target))}</div></div>
      <div class="bar" style="flex-basis:100%;margin-left:52px;height:6px"><i class="${c.done ? '' : ''}" style="width:${c.p * 100}%"></i></div></button>`;
  }
  function viewGoals() {
    const bal = balances();
    const tot = S.goals.reduce((a, g) => { const c = goalCalc(g, bal); a.s += Math.min(c.saved, c.target); a.t += c.target; return a; }, { s: 0, t: 0 });
    return `<div class="card hero"><div class="label">Saved towards goals</div><div class="big amt">${esc(fmt(tot.s))}</div>
      <div class="split"><div><small>Total targets</small><b class="amt">${esc(fmt(tot.t))}</b></div><div><small>Progress</small><b>${tot.t ? Math.round((tot.s / tot.t) * 100) : 0}%</b></div></div></div>
      <div class="row" style="margin-bottom:12px"><div class="grow small muted">Emergency fund, car, home, travel…</div><button class="btn primary" data-act="add-goal">+ Goal</button></div>
      ${S.goals.length ? `<div class="list">${S.goals.map((g) => goalItem(g, bal)).join('')}</div>` : '<div class="list"><div class="empty"><div class="em">🎯</div>Tip: start with an emergency fund of 6 months of expenses.</div></div>'}`;
  }
  function viewGoal(id) {
    const g = S.goals.find((x) => x.id === id);
    if (!g) { st.sub = null; return viewInvest(); }
    const c = goalCalc(g);
    const list = [...(g.contributions || [])].sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card hero"><div class="label">${g.icon || '🎯'} ${esc(g.name)}</div><div class="big amt">${esc(fmt(c.saved))}</div>
      <div class="bar" style="background:rgba(255,255,255,.2);margin-bottom:12px"><i style="width:${c.p * 100}%;background:#fff"></i></div>
      <div class="split"><div><small>Target</small><b class="amt">${esc(fmt(c.target))}</b></div><div><small>${g.targetDate ? 'By' : 'Progress'}</small><b>${g.targetDate ? fmtDate(g.targetDate) : Math.round(c.p * 100) + '%'}</b></div></div></div>
      <div class="card"><b class="amt">${esc(goalLine(g, c))}</b>${g.linkedAccountId ? `<div class="small muted" style="margin-top:6px">Tracks the balance of <b>${esc(accName(g.linkedAccountId))}</b>.</div>` : ''}</div>
      <div class="btn-row" style="margin-bottom:14px">${g.linkedAccountId ? '' : `<button class="btn primary" data-act="goal-money" data-id="${g.id}" data-type="add">+ Add money</button><button class="btn" data-act="goal-money" data-id="${g.id}" data-type="withdraw">− Take out</button>`}
        <button class="btn" data-act="edit-goal" data-id="${g.id}">Edit</button></div>
      ${g.linkedAccountId ? '' : `<div class="section-title">History</div>${list.length ? `<div class="list">${list.map((x) => `<div class="item"><div class="avatar ${x.type === 'withdraw' ? 'expense' : 'income'}">${x.type === 'withdraw' ? ICON.out : ICON.in}</div>
        <div class="grow"><div class="title">${x.type === 'withdraw' ? 'Taken out' : 'Added'}</div><div class="sub">${fmtDate(x.date)}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        <b>${money(x.amount, x.type === 'withdraw' ? 'neg' : 'pos')}</b><button class="mini-btn" data-act="goal-del" data-id="${g.id}" data-c="${x.id}" aria-label="Remove">✕</button></div>`).join('')}</div>` : '<div class="list"><div class="empty">Nothing added yet.</div></div>'}`}`;
  }
  function goalForm(g) {
    openForm({
      title: g ? 'Edit goal' : 'New savings goal',
      values: g ? { ...g } : { icon: '🛟', name: '', target: '', targetDate: '', linkedAccountId: '', startAmount: '' },
      fields: (v) => [
        { name: 'icon', type: 'segment', options: GOAL_ICONS.map((i) => [i, i]) },
        { name: 'name', label: 'Goal', required: true, placeholder: 'e.g. Emergency fund, New car' },
        { name: 'target', label: 'Target amount', type: 'number', half: true },
        { name: 'targetDate', label: 'Target date (optional)', type: 'date', half: true },
        { name: 'linkedAccountId', label: 'Track using an account balance (optional)', type: 'select', rerender: true, options: [['', 'No — I’ll add money manually'], ...S.accounts.map((a) => [a.id, a.name])], help: 'Pick a separate savings account / RD if you keep this money there.' },
        ...(v.linkedAccountId ? [] : [{ name: 'startAmount', label: 'Already saved', type: 'number' }]),
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSave: (v) => {
        if (!v.name.trim()) return 'Enter a name';
        if (!(num(v.target) > 0)) return 'Enter a target amount';
        const rec = { icon: v.icon || '🎯', name: v.name.trim(), target: num(v.target), targetDate: v.targetDate || '', linkedAccountId: v.linkedAccountId || '', startAmount: num(v.startAmount), notes: (v.notes || '').trim() };
        if (g) Object.assign(g, rec); else S.goals.push({ id: uid(), contributions: [], created: iso(), ...rec });
        save(); toast('Goal saved'); return true;
      },
      onDelete: g ? () => { if (!confirm('Delete this goal?')) return false; S.goals = S.goals.filter((x) => x.id !== g.id); save(); st.sub = null; return true; } : null,
    });
  }
  function goalMoneyForm(g, type) {
    openForm({
      title: type === 'withdraw' ? 'Take money out' : 'Add money to goal',
      values: { amount: '', date: iso(), note: '' },
      fields: () => [{ name: 'amount', label: 'Amount', type: 'number', big: true }, { name: 'date', label: 'Date', type: 'date' }, { name: 'note', label: 'Note' }],
      onSave: (v) => {
        if (!(num(v.amount) > 0)) return 'Enter an amount';
        g.contributions = (g.contributions || []).concat({ id: uid(), type, amount: num(v.amount), date: v.date || iso(), note: (v.note || '').trim() });
        save(); toast('Saved'); return true;
      },
    });
  }

  // ---------- Family emergency sheet (PDF) ----------
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  async function loadPdfLib() {
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript('vendor/jspdf.umd.min.js');
    if (!window.jspdf.jsPDF.API.autoTable) await loadScript('vendor/jspdf.plugin.autotable.min.js');
  }
  function viewEmergency() {
    const E = S.emergency;
    return `<p class="small muted" style="margin-top:0">Creates one PDF with everything your family would need if something happened to you: bank accounts, FDs, PPF, insurance, loans, nominees, where documents are kept, and who to contact. Print it or keep it with a trusted person.</p>
      <div class="card"><h2 class="row"><span class="grow">Emergency contacts</span><button class="link" data-act="em-contact">+ Add</button></h2>
        ${(E.contacts || []).length ? E.contacts.map((c) => `<div class="kv"><span>${esc(c.name)}${c.relation ? ' · ' + esc(c.relation) : ''}</span><span class="val">${esc(c.phone || '')}<button class="mini-btn" data-act="em-contact" data-id="${c.id}">Edit</button></span></div>`).join('')
          : '<div class="small muted">e.g. spouse, parent, CA / tax consultant, lawyer, insurance agent, family doctor.</div>'}</div>
      <div class="card"><h2>Instructions & notes for family</h2>
        <div class="field"><textarea id="em-notes" rows="6" placeholder="e.g. Original FD receipts and property papers are in the bedroom locker. Will is with Adv. Sharma. Phone PIN is with my brother. LIC agent will help with claims…">${esc(E.notes || '')}</textarea></div>
        <div class="btn-row" style="margin-top:10px"><button class="btn" data-act="em-save">Save notes</button></div></div>
      <div class="card"><h2>Create the PDF</h2>
        <label class="field check"><input type="checkbox" id="em-bal" checked><span>Include balances & values</span></label>
        <label class="field check" style="margin-top:8px"><input type="checkbox" id="em-full"><span>Show full account / policy numbers</span></label>
        <p class="small muted">With full numbers the PDF is sensitive. Store it safely and share it only with people you trust.</p>
        <div class="btn-row"><button class="btn primary" data-act="em-pdf" data-how="open">Open PDF</button><button class="btn" data-act="em-pdf" data-how="share">Save / Share</button></div></div>`;
  }
  function contactForm(c) {
    openForm({
      title: c ? 'Edit contact' : 'Emergency contact',
      values: c ? { ...c } : {},
      fields: () => [{ name: 'name', label: 'Name', required: true }, { name: 'relation', label: 'Relation / role', half: true, placeholder: 'e.g. Spouse, CA' }, { name: 'phone', label: 'Phone', type: 'tel', half: true }, { name: 'note', label: 'Note', placeholder: 'e.g. knows about my investments' }],
      onSave: (v) => {
        if (!(v.name || '').trim()) return 'Enter a name';
        const rec = { name: v.name.trim(), relation: (v.relation || '').trim(), phone: (v.phone || '').trim(), note: (v.note || '').trim() };
        S.emergency = { ...S.emergency, contacts: [...(S.emergency.contacts || [])] };
        if (c) Object.assign(S.emergency.contacts.find((x) => x.id === c.id), rec); else S.emergency.contacts.push({ id: uid(), ...rec });
        save(); return true;
      },
      onDelete: c ? () => { S.emergency = { ...S.emergency, contacts: S.emergency.contacts.filter((x) => x.id !== c.id) }; save(); return true; } : null,
    });
  }
  async function makeEmergencyPdf({ balances: showBal, full }) {
    await loadPdfLib();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const clean = (s) => String(s ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '').trim();
    const cur = S.settings.currency || 'INR';
    const R = (n) => (showBal ? (cur === 'INR' ? 'Rs. ' : cur + ' ') + Math.round(num(n)).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US') : '-');
    const no = (s) => (s ? (full ? String(s) : mask(String(s)).replace('•••• ', 'XXXX')) : '');
    const d = (s) => (s ? fmtDate(s) : '');
    let y = 50;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(15, 118, 110);
    pdf.text('Family Financial Information', 40, y); y += 20;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(80);
    pdf.text(clean(`${S.settings.name ? 'Prepared by ' + S.settings.name + ' · ' : ''}Generated on ${fmtDate(iso())} from Account Manager`), 40, y); y += 14;
    pdf.setTextColor(150, 60, 0);
    pdf.text('Confidential: keep this document private and in a safe place.', 40, y); y += 22;
    pdf.setTextColor(0);
    const section = (title, head, rows, note) => {
      if (!rows.length) return;
      if (y > 740) { pdf.addPage(); y = 50; }
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12.5); pdf.setTextColor(15, 118, 110); pdf.text(clean(title), 40, y);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0);
      pdf.autoTable({ startY: y + 6, head: [head.map(clean)], body: rows.map((r) => r.map(clean)), theme: 'grid', margin: { left: 40, right: 40 },
        styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: [15, 118, 110], textColor: 255 } });
      y = pdf.lastAutoTable.finalY + (note ? 12 : 24);
      if (note) { pdf.setFontSize(8.5); pdf.setTextColor(110); pdf.text(clean(note), 40, y); pdf.setTextColor(0); y += 18; }
    };
    const nw = netWorth();
    const act = S.policies.filter(policyActive);
    const cov = (t) => act.filter((p) => t.includes(p.type)).reduce((s, p) => s + num(p.sumAssured), 0);
    if (showBal) section('Summary', ['Item', 'Amount'], [['Net worth', R(nw.total)], ['Total assets', R(nw.assets)], ['Total liabilities / loans', R(nw.liabilities)], ['Life insurance cover', R(cov(['term', 'life']))], ['Health insurance cover', R(cov(['health']))]]);
    section('Emergency contacts', ['Name', 'Relation', 'Phone', 'Note'], (S.emergency.contacts || []).map((c) => [c.name, c.relation, c.phone, c.note]));
    if ((S.emergency.notes || '').trim()) {
      if (y > 700) { pdf.addPage(); y = 50; }
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12.5); pdf.setTextColor(15, 118, 110); pdf.text('Instructions & notes', 40, y); y += 16;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(0);
      pdf.splitTextToSize(clean(S.emergency.notes), W - 80).forEach((line) => { if (y > 790) { pdf.addPage(); y = 50; } pdf.text(line, 40, y); y += 13; });
      y += 14;
    }
    const b = balances();
    const banks = S.accounts.filter((a) => a.type !== 'credit' && !a.archived);
    section('Bank accounts, cash & wallets', ['Account', 'Bank', 'Type', 'Account no.', 'IFSC / Branch', 'Holder', 'Nominee', 'Balance'],
      banks.map((a) => [a.name, a.bankName, a.subtype || (ACCOUNT_TYPES[a.type] || {}).label, no(a.accountNumber), [a.ifsc, a.branch].filter(Boolean).join(' / '), a.holder, a.nominee, R(b[a.id] || 0)]));
    section('Credit cards', ['Card', 'Bank', 'Last 4', 'Limit', 'Outstanding'], S.accounts.filter((a) => a.type === 'credit' && !a.archived).map((a) => [a.name, a.bankName, a.cardLast4, R(a.creditLimit), R(Math.max(0, -(b[a.id] || 0)))]));
    section('Fixed deposits', ['Bank', 'FD no.', 'Holder', 'Amount', 'Rate', 'Matures', 'Maturity value', 'Nominee'],
      S.fds.filter((f) => f.status !== 'closed').map((f) => { const c = fdCalc(f); return [f.bank, no(f.fdNumber), f.holder, R(f.principal), num(f.rate) + '%', d(c.matISO), R(c.maturity), f.nominee]; }));
    section('PPF accounts', ['Holder', 'Bank / PO', 'Account no.', 'Balance', 'Matures', 'Nominee'],
      S.ppf.filter((p) => p.status !== 'closed').map((p) => { const c = ppfCalc(p); return [p.holder, p.bank, no(p.accountNumber), R(c.current), d(c.matISO), p.nominee]; }));
    section('Insurance policies', ['Type', 'Insurer / plan', 'Policy no.', 'Insured', 'Cover', 'Premium', 'Nominee', 'Agent / helpline'],
      act.map((p) => [(POLICY_TYPES[p.type] || POLICY_TYPES.other)[0], [p.insurer, p.planName].filter(Boolean).join(' - '), no(p.policyNumber), p.insured, R(p.sumAssured), p.frequency === 'single' ? 'Single' : `${R(p.premium)} ${freqLabel(p.frequency).toLowerCase()}`, p.nominee, [p.agentName, p.agentPhone, p.helpline].filter(Boolean).join(', ')]));
    section('Other assets', ['Asset', 'Category', 'Value', 'Notes'], S.assets.filter((x) => x.kind !== 'liability').map((x) => [x.name, x.category, R(x.value), x.notes]));
    section('Loans & liabilities', ['Loan', 'Type', 'Outstanding', 'EMI', 'Notes'], S.assets.filter((x) => x.kind === 'liability').map((x) => [x.name, x.category, R(x.value), x.emi ? R(x.emi) : '', x.notes]));
    section('Important documents', ['Document', 'Category', 'Expiry', 'Notes / where the original is'], [...S.documents].filter((x) => x.category !== 'Bills & Receipts').sort((a, c) => a.category.localeCompare(c.category)).map((x) => [x.name, x.category, d(x.expiry), x.notes]),
      'Digital copies are in the Account Manager app (Docs tab).');
    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(140); pdf.text(`Page ${i} of ${pages}`, W - 90, 820); }
    return pdf.output('blob');
  }

  // ---------- SMS → entries ----------
  const CAT_RULES = [
    [/swiggy|zomato|restaurant|cafe|domino|pizza|kfc|mcdonald|starbucks|eatsure|burger/, 'Food & Dining'],
    [/bigbasket|blinkit|zepto|instamart|dmart|grocer|jiomart|reliance fresh|nature.?s basket|more retail/, 'Groceries'],
    [/amazon|flipkart|myntra|ajio|meesho|nykaa|croma|reliance digital|tata ?cliq|decathlon/, 'Shopping'],
    [/uber|\bola\b|rapido|irctc|metro|redbus|fastag|parking|namma yatri/, 'Transport'],
    [/petrol|fuel|hpcl|iocl|bpcl|indian ?oil|bharat ?petroleum|\bshell\b/, 'Fuel'],
    [/airtel|\bjio\b|vodafone|\bvi\b|bsnl|act fibernet|broadband|recharge/, 'Mobile & Internet'],
    [/electricity|bescom|msedcl|tata power|adani elec|water bill|\bgas\b|billdesk|bill ?pay/, 'Bills & Utilities'],
    [/netflix|hotstar|prime video|spotify|bookmyshow|\bpvr\b|inox|youtube/, 'Entertainment'],
    [/pharma|apollo|hospital|clinic|medplus|1mg|pharmeasy|netmeds|diagnostic|lab\b/, 'Health'],
    [/makemytrip|goibibo|indigo|air ?india|vistara|akasa|spicejet|\boyo\b|booking\.com|airbnb|cleartrip|ixigo/, 'Travel'],
    [/\blic\b|insurance|policybazaar|premium/, 'Insurance'],
    [/\bemi\b|loan/, 'EMI'],
    [/\bsip\b|mutual ?fund|zerodha|groww|upstox|kuvera|\bnps\b|ppf|bse ?star|cams|kfin/, 'Investment'],
    [/school|college|university|tuition|fees|udemy|coursera/, 'Education'],
  ];
  const INC_RULES = [[/salary|\bsal\b|payroll/, 'Salary'], [/interest|int\.? ?pd|int\.? ?cr/, 'Interest'], [/dividend/, 'Dividend'], [/refund|reversal|reversed|cashback/, 'Refund']];
  const BANK_WORDS = ['sbi', 'hdfc', 'icici', 'axis', 'kotak', 'pnb', 'baroda', 'bob', 'canara', 'union', 'idfc', 'indusind', 'yes bank', 'federal', 'au bank', 'rbl', 'idbi', 'paytm', 'airtel'];
  const merchantKey = (m) => String(m || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 24);
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseSms(raw, receivedISO) {
    let text = String(raw || '');
    if (/%[0-9A-Fa-f]{2}/.test(text)) { try { text = decodeURIComponent(text.replace(/\+/g, ' ')); } catch {} }
    const t = text.replace(/\s+/g, ' ').trim();
    const low = t.toLowerCase();
    if (!t || /\botp\b|one time password|verification code|do not share/.test(low) && !/debited|credited/.test(low)) return null;
    if (/will be debited|is due|due on|due date|has requested|requested money|collect request|reminder|e-?mandate|autopay .*(set|registered)|minimum amount due|statement (is )?generated/.test(low)) return null;
    const am = t.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) || t.match(/\b(?:debited|credited|spent|paid|sent|received)\s+(?:by|with|for|of)?\s*([\d,]+(?:\.\d{1,2})?)\b/i);
    if (!am) return null;
    const amount = num(am[1]);
    if (!(amount > 0)) return null;
    const di = low.search(/\b(debited|spent|sent|paid|withdrawn|withdrawal|purchase|deducted|debit|transferred)\b|\bdr\b/);
    const ci = low.search(/\b(credited|received|deposited|refunded|refund|reversed|credit)\b|\bcr\b/);
    if (di < 0 && ci < 0) return null;
    let type = di >= 0 && (ci < 0 || di < ci) ? 'expense' : 'income';
    const accM = t.match(/(?:a\/c|acct|account|card|\bac)\s*(?:no\.?|number)?\s*(?:ending(?: with)?|end)?\s*[:\-]?\s*(?:[x*•.]+\s*)?(\d{3,6})\b/i);
    const last = accM ? accM[1].slice(-4) : '';
    let account = null;
    if (last) account = S.accounts.find((a) => (a.accountNumber && String(a.accountNumber).replace(/\D/g, '').endsWith(last)) || (a.cardLast4 && String(a.cardLast4).endsWith(last.slice(-4))));
    if (!account) {
      const bw = BANK_WORDS.find((w) => low.includes(w));
      if (bw) account = S.accounts.find((a) => !a.archived && (a.bankName || a.name || '').toLowerCase().includes(bw) && a.type !== 'credit' && !/\bcard\b/.test(low)) || S.accounts.find((a) => !a.archived && (a.bankName || a.name || '').toLowerCase().includes(bw));
    }
    const isCard = /\bcard\b/.test(low) && !/\bupi\b/.test(low);
    let mode = /\bupi\b|\bvpa\b|@[a-z]/.test(low) ? 'upi' : isCard ? 'card' : /neft|imps|rtgs|net ?banking|\bach\b|nach/.test(low) ? 'bank' : '';
    const atm = type === 'expense' && /\batm\b|cash withdrawal|withdrawn at/.test(low);
    // merchant / counterparty
    const kw = type === 'expense' ? ['at', 'to', 'towards', 'info', 'for'] : ['from', 'by', 'info'];
    let merchant = '';
    for (const k of kw) {
      const re = new RegExp(`\\b${k}\\b[:\\-]?\\s+(?:vpa\\s+)?([A-Za-z0-9][A-Za-z0-9 .&'@_\\-/]{1,40}?)(?=\\s+(?:on|ref\\w*|via|using|upi|avl|avbl|bal|txn|dated|is|for|from|to)\\b|[.,;(]|\\s*$)`, 'i');
      const m = t.match(re);
      if (m && !/^(?:a\/c|ac\b|acct\b|account\b|card\b|your\b|xx|\*|rs\b|inr\b|neft\b|imps\b|rtgs\b|date\b)/i.test(m[1]) && !/^[\d.,]+$/.test(m[1])) { merchant = m[1].trim(); break; }
    }
    merchant = merchant.replace(/\s+/g, ' ').slice(0, 40);
    // date in SMS
    let date = receivedISO || iso();
    const dm = t.match(/\b(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})\b/) || t.match(/\b(\d{1,2})[-\/. ]?([A-Za-z]{3})[a-z]*[-\/. ,]*(\d{2,4})\b/);
    const ym = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    let pd = null;
    if (ym) pd = new Date(+ym[1], +ym[2] - 1, +ym[3]);
    else if (dm) {
      const mo = isNaN(dm[2]) ? MONTHS[dm[2].toLowerCase()] : +dm[2] - 1;
      let yr = +dm[3]; if (yr < 100) yr += 2000;
      if (mo >= 0 && mo <= 11 && +dm[1] >= 1 && +dm[1] <= 31) pd = new Date(yr, mo, +dm[1]);
    }
    if (pd && !isNaN(pd) && pd <= new Date(Date.now() + 864e5) && pd > new Date(Date.now() - 400 * 864e5)) date = iso(pd);
    // category
    const key = merchantKey(merchant);
    let category = (key && S.smsLearn[key]) || '';
    if (!category) {
      const rules = type === 'income' ? INC_RULES : CAT_RULES;
      const hit = rules.find(([re]) => re.test(low));
      category = hit ? hit[1] : 'Other';
    }
    const res = { amount, type, accountId: account ? account.id : '', toAccountId: '', mode, category, note: merchant, date, raw: t, last, merchantKey: key };
    if (atm) {
      const cashAcc = S.accounts.find((a) => a.type === 'cash' && !a.archived);
      Object.assign(res, { type: cashAcc ? 'transfer' : 'expense', toAccountId: cashAcc ? cashAcc.id : '', category: cashAcc ? '' : 'Other', mode: cashAcc ? '' : 'cash', note: merchant || 'ATM withdrawal' });
    }
    res.duplicate = S.transactions.some((x) => num(x.amount) === amount && x.type === res.type && (!res.accountId || x.accountId === res.accountId) && Math.abs(daysBetween(parseDate(x.date), parseDate(res.date))) <= 1);
    return res;
  }

  // Inbox items come from the cloud (iPhone Shortcut / Android automation) or from pasting.
  let inboxItems = [];
  const handledInbox = new Set();
  function setInboxItems(items) { inboxItems = items.filter((x) => !handledInbox.has(x.id)); scheduleRender(); }
  function pendingSms() {
    const all = [...inboxItems.map((x) => ({ ...x, src: 'cloud' })), ...(st.pasted || [])];
    const seen = new Set();
    return all.filter((x) => !handledInbox.has(x.id)).filter((x) => {
      const k = String(x.text || '').replace(/%20|\s+/g, ' ').trim();
      if (seen.has(k)) { if (x.src === 'cloud') { handledInbox.add(x.id); Cloud.deleteInboxItem(S.settings.inboxToken, x.id); } return false; }
      seen.add(k); return true;
    }).map((x) => ({ ...x, p: x.p || parseSms(x.text, x.at) }));
  }
  function dropSms(item) {
    handledInbox.add(item.id);
    if (item.src === 'cloud') Cloud.deleteInboxItem(S.settings.inboxToken, item.id);
    st.pasted = (st.pasted || []).filter((x) => x.id !== item.id);
    inboxItems = inboxItems.filter((x) => x.id !== item.id);
  }
  function learnCategory(p, category) {
    if (p && p.merchantKey && category && category !== 'Other' && S.smsLearn[p.merchantKey] !== category) S.smsLearn = { ...S.smsLearn, [p.merchantKey]: category };
  }
  function addFromSms(item) {
    const p = item.p;
    S.transactions.push({ id: uid(), type: p.type, amount: p.amount, accountId: p.accountId, toAccountId: p.toAccountId || '', category: p.category, mode: p.mode, note: p.note, date: p.date, created: new Date().toISOString(), fromSms: true });
    if (p.category && p.type !== 'transfer' && !S.categories[p.type].includes(p.category)) S.categories[p.type].push(p.category);
    learnCategory(p, p.category);
    dropSms(item);
  }
  function viewInbox() {
    const items = pendingSms();
    const ok = items.filter((x) => x.p && x.p.accountId && !x.p.duplicate);
    let html = `<div class="card"><h2>Paste SMS</h2><p class="small muted" style="margin-top:0">Copy one or more bank SMS and paste them here (separate several with a blank line).</p>
      <div class="field"><textarea id="sms-paste" rows="4" placeholder="Rs.450.00 debited from A/c XX1234 on 23-11-26 to VPA swiggy@icici UPI Ref 6312…"></textarea></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" data-act="sms-read">Read SMS</button></div></div>`;
    if (!items.length) return html + '<div class="list"><div class="empty"><div class="em">📩</div>No SMS waiting.<br><span class="small">Set up automatic forwarding in ⋮ → SMS auto-add.</span></div></div>';
    html += `<div class="row" style="margin:6px 0 10px"><b class="grow">${items.length} waiting</b>${ok.length > 1 ? `<button class="btn primary" data-act="sms-addall">Add all ${ok.length} ready</button>` : ''}</div>`;
    html += items.map((x) => {
      const p = x.p;
      if (!p) return `<div class="card sms"><div class="small muted">Not a transaction SMS</div><div class="raw">${esc(String(x.text || '').slice(0, 220))}</div><div class="btn-row"><button class="btn" data-act="sms-ignore" data-id="${x.id}">Remove</button></div></div>`;
      const sign = p.type === 'income' ? 'pos' : p.type === 'expense' ? 'neg' : '';
      return `<div class="card sms"><div class="row"><b class="${sign}" style="font-size:20px">${p.type === 'income' ? '+' : p.type === 'expense' ? '−' : '⇄'} ${money(p.amount)}</b><span class="grow"></span>
        ${p.duplicate ? '<span class="badge warn">Possible duplicate</span>' : !p.accountId ? '<span class="badge warn">Pick account</span>' : '<span class="badge ok">Ready</span>'}</div>
        <div class="small" style="margin:6px 0">${p.type === 'transfer' ? `ATM → ${esc(accName(p.toAccountId))}` : esc(p.category)}${p.note ? ' · ' + esc(p.note) : ''} · ${fmtDate(p.date)}${p.accountId ? ' · ' + esc(accName(p.accountId)) : ''}${p.mode ? ' · ' + (MODE_LABEL[p.mode] || '') : ''}</div>
        <div class="raw">${esc(p.raw.slice(0, 220))}</div>
        <div class="btn-row"><button class="btn danger" data-act="sms-ignore" data-id="${x.id}">Ignore</button><button class="btn" data-act="sms-edit" data-id="${x.id}">Edit</button>${p.accountId ? `<button class="btn primary" data-act="sms-add" data-id="${x.id}">Add</button>` : ''}</div></div>`;
    }).join('');
    return html;
  }
  function viewSmsSetup() {
    if (!signedIn()) return `<div class="card"><p>SMS auto-add needs <b>Cloud Sync</b>, because your phone sends bank SMS to your private cloud inbox.</p><button class="btn primary block" data-act="open" data-kind="cloud">Sign in to Cloud Sync</button></div>
      <p class="small muted">You can still copy & paste SMS: <button class="link" data-act="open" data-kind="inbox">Paste SMS</button></p>`;
    const tok = S.settings.inboxToken;
    if (!tok) return `<div class="card"><h2>Bank SMS → entries</h2><p class="small muted" style="margin-top:0">Your phone forwards each bank SMS to a private inbox in your cloud. The app reads the amount, account, merchant and date, guesses the category (and learns from your corrections), and you add each one with a tap.</p>
      <button class="btn primary block" data-act="sms-enable">Turn on SMS inbox</button></div>`;
    const url = Cloud.inboxUrl(tok);
    const body = '{"fields":{"text":{"stringValue":"URL_ENCODED_TEXT"},"src":{"stringValue":"ios"}}}';
    const n = pendingSms().length;
    return `<div class="card"><div class="row"><div class="grow"><b>SMS inbox is on</b><div class="small muted">${n} message${n === 1 ? '' : 's'} waiting</div></div><button class="btn primary" data-act="open" data-kind="inbox">Review</button></div></div>
      <div class="card"><h2>iPhone setup (one time, ~5 min)</h2>
      <ol class="steps">
        <li>Open the <b>Shortcuts</b> app → <b>Automation</b> tab → <b>+</b> → <b>Message</b>.</li>
        <li><b>Message Contains:</b> type <code>Rs</code>. Choose <b>Run Immediately</b> (turn off “Notify When Run” if you like) → <b>Next</b> → <b>New Blank Automation</b>.</li>
        <li>Add action <b>URL Encode</b>. Tap its input and choose <b>Shortcut Input</b>.</li>
        <li>Add action <b>Text</b> and paste this, then replace <code>URL_ENCODED_TEXT</code> with the blue <b>URL Encoded Text</b> variable:
          <div class="codebox">${esc(body)}</div><button class="mini-btn" data-act="copy" data-text="${esc(body)}">Copy text</button></li>
        <li>Add action <b>Get Contents of URL</b>. Paste this URL:
          <div class="codebox">${esc(url)}</div><button class="mini-btn" data-act="copy" data-text="${esc(url)}">Copy URL</button>
          <br>Tap <b>Show More</b> → Method <b>POST</b> → Headers: add <code>Content-Type</code> = <code>application/json</code> → Request Body <b>File</b> → choose the <b>Text</b> variable.</li>
        <li>Tap <b>Done</b>. Repeat steps 1–5 twice more with <code>INR</code> and <code>debited</code> instead of <code>Rs</code>, so every bank format is caught. (Duplicates are removed automatically.)</li>
      </ol>
      <div class="btn-row"><button class="btn" data-act="sms-test">Send a test message</button></div>
      <p class="small muted">Android: the same URL works with MacroDroid or Tasker (“SMS received” → HTTP POST with the body above).</p></div>
      <div class="card"><h2>Privacy</h2><p class="small muted" style="margin-top:0">The link contains a long secret code. Anyone with the link could only <i>drop</i> messages into your inbox. Nobody can read your inbox or data without your login. Messages are deleted once you add or ignore them.</p>
      <button class="btn danger block" data-act="sms-reset">Reset link (stops the old Shortcut)</button></div>`;
  }
  function newInboxToken() {
    const a = new Uint8Array(24); crypto.getRandomValues(a);
    return [...a].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 40);
  }
  async function enableInbox() {
    const tok = newInboxToken();
    try { await Cloud.claimInbox(tok); }
    catch (e) { return alert('Could not turn on the SMS inbox: ' + (e.code === 'permission-denied' ? 'please deploy the latest firestore.rules first (npx firebase-tools deploy).' : (e.message || e)) + (navigator.onLine ? '' : ' You need to be online.')); }
    S.settings.inboxToken = tok; save(); startInboxWatch(); render();
  }
  function startInboxWatch() {
    if (signedIn() && S.settings.inboxToken) Cloud.watchInbox(S.settings.inboxToken, setInboxItems);
  }

  // =====================================================================
  // v1.5: bills & subscriptions, warranties, vehicles, global search,
  // credit card cycles
  // =====================================================================
  const clampDate = (y, m, d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
  const ensureCat = (type, c) => { if (c && S.categories[type] && !S.categories[type].includes(c)) S.categories[type].push(c); };
  const defaultPayAccount = () => { const a = S.accounts.filter((x) => !x.archived); return (a.find((x) => x.type === 'bank') || a[0] || {}).id || ''; };

  // ---------- Credit card cycles ----------
  function cardCycle(a) {
    const sd = Math.min(31, num(a.statementDay)), dd = Math.min(31, num(a.dueDay));
    if (a.type !== 'credit' || !sd) return null;
    const t = today0();
    let lastSt = clampDate(t.getFullYear(), t.getMonth(), sd);
    if (lastSt > t) lastSt = clampDate(t.getFullYear(), t.getMonth() - 1, sd);
    const prevSt = clampDate(lastSt.getFullYear(), lastSt.getMonth() - 1, sd);
    const nextSt = clampDate(lastSt.getFullYear(), lastSt.getMonth() + 1, sd);
    let due = null;
    if (dd) { due = clampDate(lastSt.getFullYear(), lastSt.getMonth(), dd); if (due <= lastSt) due = clampDate(lastSt.getFullYear(), lastSt.getMonth() + 1, dd); }
    const lastISO = iso(lastSt), prevISO = iso(prevSt);
    const out = (x) => (x.type === 'expense' || x.type === 'transfer') && x.accountId === a.id;
    const inn = (x) => (x.type === 'income' && x.accountId === a.id) || (x.type === 'transfer' && x.toAccountId === a.id);
    const stmtDue = Math.max(0, -(balances(lastISO)[a.id] || 0));
    const paidSince = sum(S.transactions.filter((x) => x.date > lastISO && inn(x)));
    const unbilled = sum(S.transactions.filter((x) => x.date > lastISO && out(x)));
    const stmtSpends = sum(S.transactions.filter((x) => x.date > prevISO && x.date <= lastISO && out(x)));
    const cycleStart = new Date(lastSt); cycleStart.setDate(cycleStart.getDate() + 1);
    return { lastISO, nextISO: iso(nextSt), cycleStartISO: iso(cycleStart), dueISO: due ? iso(due) : '', daysToDue: due ? daysBetween(t, due) : null,
      stmtDue, stmtSpends, unbilled, paidSince, remaining: Math.max(0, stmtDue - paidSince) };
  }
  function cardCycleCard(a, bal) {
    const c = cardCycle(a);
    const used = Math.max(0, -bal), lim = num(a.creditLimit), util = lim ? used / lim : 0;
    const utilHtml = lim ? `<div class="kv"><span>Card usage</span><span class="val"><span class="${util > 0.3 ? 'neg' : ''}">${Math.round(util * 100)}%</span> of limit</span></div>
      <div class="bar" style="margin:-2px 0 6px"><i class="${util > 0.75 ? 'over' : util > 0.3 ? 'warn' : ''}" style="width:${Math.min(100, util * 100)}%"></i></div>
      ${util > 0.3 ? '<div class="small muted" style="margin-bottom:6px">Tip: keeping usage under 30% helps your credit score.</div>' : ''}` : '';
    if (!c) return `<div class="card"><h2>Billing cycle</h2>${utilHtml}<p class="small muted" style="margin:0">Add the <b>statement day</b> in “Edit details” to see this cycle's spends and exactly how much to pay by the due date.</p></div>`;
    const status = c.remaining <= 0 ? (c.stmtDue > 0 ? '<span class="badge ok">Paid ✓</span>' : '<span class="badge ok">Nothing due</span>')
      : c.daysToDue === null ? '' : c.daysToDue < 0 ? `<span class="badge warn">Overdue ${-c.daysToDue}d</span>` : `<span class="badge warn">Due in ${c.daysToDue}d</span>`;
    return `<div class="card"><h2>Billing cycle</h2>
      <div class="grid2" style="margin-bottom:10px"><div class="stat"><small>To pay${c.dueISO ? ' by ' + fmtDate(c.dueISO).replace(/ \d{4}$/, '') : ''}</small><b>${money(c.remaining, c.remaining > 0 ? 'neg' : '')}</b></div>
        <div class="stat"><small>This cycle (unbilled)</small><b>${money(c.unbilled)}</b></div></div>
      ${kv('Last statement', `${fmtDate(c.lastISO)} · ${fmt(c.stmtDue)}`)}
      <div class="kv"><span>Status</span><span class="val">${status}</span></div>
      ${kv('Paid since statement', money(c.paidSince), { html: true })}
      ${kv('Spent in last cycle', money(c.stmtSpends), { html: true })}
      ${kv('Current cycle', `${fmtDate(c.cycleStartISO)} – ${fmtDate(c.nextISO)}`)}
      ${utilHtml}
      ${c.remaining > 0 ? `<button class="btn primary block" style="margin-top:8px" data-act="pay-card" data-id="${a.id}">Pay ${esc(fmt(c.remaining))}</button>` : ''}</div>`;
  }

  // ---------- Bills & subscriptions ----------
  const BILL_FREQ = [['monthly', 'Monthly', 1], ['bimonthly', 'Every 2 months', 2], ['quarterly', 'Quarterly', 3], ['half-yearly', 'Half-yearly', 6], ['yearly', 'Yearly', 12]];
  const billMonths = (f) => (BILL_FREQ.find((x) => x[0] === f) || BILL_FREQ[0])[2];
  const billFreqLabel = (f) => (BILL_FREQ.find((x) => x[0] === f) || BILL_FREQ[0])[1];
  const BILL_CATS = ['Bills & Utilities', 'Mobile & Internet', 'Entertainment', 'Rent', 'Insurance', 'Education', 'EMI', 'Health', 'Other'];
  const billIcon = (b) => ({ 'Mobile & Internet': '📶', Entertainment: '📺', Rent: '🏠', Insurance: '🛡️', Education: '🎓', EMI: '🏦', Health: '💊' }[b.category] || (b.kind === 'subscription' ? '🔁' : '🧾'));
  const billPayments = (b) => S.transactions.filter((t) => t.billId === b.id).sort((x, y) => y.date.localeCompare(x.date));
  function billTypical(b) {
    if (num(b.amount) > 0) return num(b.amount);
    const p = billPayments(b).slice(0, 3);
    return p.length ? sum(p) / p.length : 0;
  }
  function billItem(b) {
    const d = b.nextDue ? daysBetween(today0(), parseDate(b.nextDue)) : null;
    const badge = !b.active ? '<span class="badge">Paused</span>' : d === null ? '' : d < 0 ? `<span class="badge warn">Overdue ${-d}d</span>` : d === 0 ? '<span class="badge warn">Due today</span>' : d <= 7 ? `<span class="badge warn">Due in ${d}d</span>` : '';
    const amt = num(b.amount) > 0 ? money(b.amount) : billTypical(b) ? `<span class="muted small">~</span>${money(billTypical(b))}` : '<span class="muted small">varies</span>';
    return `<div class="item" data-act="edit-bill" data-id="${b.id}" role="button"><div class="avatar">${billIcon(b)}</div>
      <div class="grow"><div class="title ellipsis">${esc(b.name)}</div><div class="sub ellipsis">${badge ? badge + ' ' : ''}${b.nextDue ? fmtDate(b.nextDue) + ' · ' : ''}${esc(billFreqLabel(b.frequency))}${b.autoPay ? ' · auto-debit' : ''}</div></div>
      <div class="right"><b>${amt}</b>${b.active && !b.autoPay ? `<div><button class="mini-btn pay" data-act="pay-bill" data-id="${b.id}">Pay</button></div>` : ''}</div></div>`;
  }
  function viewBills() {
    const act = S.bills.filter((b) => b.active);
    const monthly = act.reduce((s, b) => s + billTypical(b) / billMonths(b.frequency), 0);
    const subsYear = act.filter((b) => b.kind === 'subscription').reduce((s, b) => s + (billTypical(b) * 12) / billMonths(b.frequency), 0);
    const mEnd = iso(new Date(today0().getFullYear(), today0().getMonth() + 1, 0));
    const dueNow = act.filter((b) => b.nextDue && b.nextDue <= mEnd).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
    const later = S.bills.filter((b) => !dueNow.includes(b)).sort((a, b) => (b.active - a.active) || (a.nextDue || '9').localeCompare(b.nextDue || '9'));
    return `<div class="card hero"><div class="label">Bills & subscriptions per month</div><div class="big amt">${esc(fmt(monthly))}</div>
      <div class="split"><div><small>Due this month</small><b class="amt">${(() => { const tot = dueNow.reduce((s, b) => s + billTypical(b), 0); const varies = dueNow.some((b) => !billTypical(b)); return `${dueNow.length} bill${dueNow.length === 1 ? '' : 's'}${tot ? ' · ' + esc(fmt(tot)) + (varies ? '+' : '') : ''}`; })()}</b></div><div><small>Subscriptions / year</small><b class="amt">${esc(fmt(subsYear))}</b></div></div></div>
      <div class="row" style="margin-bottom:12px"><div class="grow small muted">Tap <b>Pay</b> to record a payment. Auto-debit bills record themselves.</div><button class="btn primary" data-act="add-bill">+ Bill</button></div>
      ${dueNow.length ? `<div class="section-title">Due this month</div><div class="list">${dueNow.map(billItem).join('')}</div>` : ''}
      ${later.length ? `<div class="section-title">${dueNow.length ? 'Later' : 'All bills'}</div><div class="list">${later.map(billItem).join('')}</div>` : ''}
      ${S.bills.length ? '' : '<div class="list"><div class="empty"><div class="em">🧾</div>Add electricity, water, gas, mobile, broadband, rent, OTT subscriptions, gym, school fees…</div></div>'}`;
  }
  function billForm(b) {
    openForm({
      title: b ? 'Edit bill' : 'New bill / subscription',
      values: b ? { ...b } : { kind: 'bill', frequency: 'monthly', category: 'Bills & Utilities', nextDue: iso(), accountId: defaultPayAccount(), mode: 'upi', active: true, _touched_mode: true },
      fields: (v) => [
        { name: 'kind', type: 'segment', options: [['bill', 'Bill'], ['subscription', 'Subscription']] },
        { name: 'name', label: 'Name', required: true, placeholder: v.kind === 'subscription' ? 'e.g. Netflix, Spotify, Gym' : 'e.g. Electricity, Airtel postpaid, Rent' },
        { name: 'category', label: 'Category', type: 'list', options: BILL_CATS, half: true },
        { name: 'consumerNo', label: 'Consumer / customer no.', half: true },
        { name: 'amount', label: 'Usual amount', type: 'number', half: true, help: 'Leave blank if it changes every time' },
        { name: 'frequency', label: 'Repeats', type: 'select', options: BILL_FREQ.map(([k, l]) => [k, l]), half: true },
        { name: 'nextDue', label: 'Next due date', type: 'date' },
        { name: 'accountId', label: 'Usually paid from', type: 'select', options: S.accounts.filter((a) => !a.archived).map((a) => [a.id, `${accIcon(a)} ${a.name}`]) },
        { name: 'mode', label: 'Paid by', type: 'segment', options: PAY_MODES },
        { name: 'autoPay', label: 'Auto-debit (records the payment automatically on the due date — needs a usual amount)', type: 'checkbox' },
        { name: 'link', label: 'Website / app to pay (optional)', placeholder: 'e.g. https://…' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        ...(b ? [{ name: 'active', label: 'Active (uncheck to pause)', type: 'checkbox' },
          { name: 'hist', type: 'preview', render: () => { const p = billPayments(b).slice(0, 4); return p.length ? `<div class="small"><b>Recent payments</b>${p.map((t) => `<div class="kv"><span>${fmtDate(t.date)}</span><span class="val">${money(t.amount)}</span></div>`).join('')}</div>` : '<span class="small">No payments recorded yet.</span>'; } }] : []),
      ],
      onSave: (v) => {
        if (!(v.name || '').trim()) return 'Enter a name';
        if (!v.nextDue) return 'Enter the next due date';
        if (v.autoPay && !(num(v.amount) > 0)) return 'Auto-debit needs a usual amount';
        const rec = { kind: v.kind || 'bill', name: v.name.trim(), category: (v.category || '').trim() || 'Bills & Utilities', consumerNo: (v.consumerNo || '').trim(), amount: num(v.amount) || '', frequency: v.frequency, nextDue: v.nextDue, accountId: v.accountId || '', mode: v.mode || '', autoPay: !!v.autoPay, link: (v.link || '').trim(), notes: (v.notes || '').trim(), active: b ? !!v.active : true };
        if (b) Object.assign(b, rec); else S.bills.push({ id: uid(), ...rec });
        save(); if (!runRecurring()) toast('Saved'); return true;
      },
      extra: b && b.link ? [{ label: 'Open pay link', act: () => { window.open(b.link, '_blank'); return false; } }] : [],
      onDelete: b ? () => { if (!confirm('Delete this bill? Recorded payments are kept.')) return false; S.bills = S.bills.filter((x) => x.id !== b.id); save(); return true; } : null,
    });
  }
  function payBillForm(b) {
    const accs = S.accounts.filter((a) => !a.archived);
    openForm({
      title: `Pay ${b.name}`,
      values: { amount: billTypical(b) ? Math.round(billTypical(b) * 100) / 100 : '', date: iso(), accountId: b.accountId || defaultPayAccount(), mode: b.mode || 'upi', _touched_mode: true, note: '' },
      fields: () => [
        { name: 'amount', label: 'Amount paid', type: 'number', big: true },
        { name: 'date', label: 'Paid on', type: 'date', half: true },
        { name: 'accountId', label: 'Paid from', type: 'select', half: true, options: accs.map((a) => [a.id, `${accIcon(a)} ${a.name}`]) },
        { name: 'mode', label: 'Paid by', type: 'segment', options: PAY_MODES },
        { name: 'note', label: 'Note', placeholder: 'e.g. bill no., units used' },
        { name: 'info', type: 'preview', render: () => `<span class="small">Records a “${esc(b.category)}” expense and moves the next due date to <b>${fmtDate(iso(addTenure(parseDate(b.nextDue || iso()), billMonths(b.frequency), 0)))}</b>.</span>` },
      ],
      onSave: (v) => {
        if (!(num(v.amount) > 0)) return 'Enter the amount';
        if (!v.accountId) return 'Choose an account';
        ensureCat('expense', b.category);
        S.transactions.push({ id: uid(), type: 'expense', amount: num(v.amount), accountId: v.accountId, toAccountId: '', category: b.category, mode: v.mode || '', note: [b.name, (v.note || '').trim()].filter(Boolean).join(' — '), date: v.date || iso(), created: new Date().toISOString(), billId: b.id });
        b.nextDue = iso(addTenure(parseDate(b.nextDue || v.date), billMonths(b.frequency), 0));
        b.lastPaid = v.date;
        save(); toast('Payment recorded'); return true;
      },
    });
  }
  function runAutoBills() {
    const today = iso(); let added = 0;
    S.bills.filter((b) => b.active && b.autoPay && num(b.amount) > 0 && b.nextDue).forEach((b) => {
      for (let guard = 0; guard < 60 && b.nextDue <= today; guard++) {
        const id = `b_${b.id}_${b.nextDue}`;
        if (!S.transactions.some((t) => t.id === id)) {
          ensureCat('expense', b.category);
          S.transactions.push({ id, type: 'expense', amount: num(b.amount), accountId: b.accountId || defaultPayAccount(), toAccountId: '', category: b.category, mode: b.mode || '', note: `${b.name} (auto-debit)`, date: b.nextDue, created: new Date().toISOString(), billId: b.id });
          added++;
        }
        b.lastPaid = b.nextDue;
        b.nextDue = iso(addTenure(parseDate(b.nextDue), billMonths(b.frequency), 0));
      }
    });
    return added;
  }

  // ---------- Warranties ----------
  function warrantyEnd(w) {
    if (w.expiry) return w.expiry;
    if (!w.purchaseDate || !(num(w.months) + num(w.extendedMonths))) return '';
    const d = addTenure(parseDate(w.purchaseDate), num(w.months) + num(w.extendedMonths), 0); d.setDate(d.getDate() - 1); return iso(d);
  }
  function warrantyItem(w) {
    const end = warrantyEnd(w);
    const d = end ? daysBetween(today0(), parseDate(end)) : null;
    const badge = d === null ? '' : d < 0 ? '<span class="badge">Expired</span>' : d <= 30 ? `<span class="badge warn">${d}d left</span>` : '<span class="badge ok">In warranty</span>';
    return `<button class="item" data-act="edit-warranty" data-id="${w.id}"><div class="avatar">${w.billDocId ? '🧾' : '📦'}</div>
      <div class="grow"><div class="title ellipsis">${esc(w.product)}${w.brand ? ' · ' + esc(w.brand) : ''}</div><div class="sub ellipsis">${badge} ${end ? (d < 0 ? 'ended ' : 'until ') + fmtDate(end) : 'no end date'}</div></div>
      <div class="right"><b>${w.price ? money(w.price) : ''}</b></div></button>`;
  }
  function viewWarranties() {
    const list = [...S.warranties].sort((a, b) => (warrantyEnd(a) || '9').localeCompare(warrantyEnd(b) || '9'));
    const t = iso();
    const active = list.filter((w) => !warrantyEnd(w) || warrantyEnd(w) >= t), expired = list.filter((w) => warrantyEnd(w) && warrantyEnd(w) < t);
    return `<p class="small muted" style="margin-top:0">Keep the bill and warranty end date for phones, laptops, TVs, ACs, appliances and more. You'll get a reminder 30 days before a warranty ends.</p>
      <div class="row" style="margin-bottom:12px"><div class="grow"><b>${active.length}</b> <span class="muted">in warranty</span></div><button class="btn primary" data-act="add-warranty">+ Product</button></div>
      ${active.length ? `<div class="list">${active.map(warrantyItem).join('')}</div>` : '<div class="list"><div class="empty"><div class="em">📦</div>No products yet.</div></div>'}
      ${expired.length ? `<div class="section-title">Expired</div><div class="list">${expired.map(warrantyItem).join('')}</div>` : ''}`;
  }
  function warrantyForm(w) {
    const bill = w && w.billDocId && S.documents.find((d) => d.id === w.billDocId);
    openForm({
      title: w ? 'Edit product' : 'New product warranty',
      values: w ? { ...w } : { purchaseDate: iso(), months: 12 },
      fields: (v) => [
        { name: 'product', label: 'Product', required: true, placeholder: 'e.g. iPhone 16, LG Washing Machine' },
        { name: 'brand', label: 'Brand', half: true },
        { name: 'model', label: 'Model', half: true },
        { name: 'serial', label: 'Serial / IMEI no.' },
        { name: 'purchaseDate', label: 'Bought on', type: 'date', half: true },
        { name: 'price', label: 'Price', type: 'number', half: true },
        { name: 'store', label: 'Bought from', half: true, placeholder: 'e.g. Croma, Amazon' },
        { name: 'months', label: 'Warranty (months)', type: 'number', half: true },
        { name: 'extendedMonths', label: 'Extended warranty (months)', type: 'number', half: true },
        { name: 'expiry', label: 'Or exact end date', type: 'date', half: true },
        { name: 'endInfo', type: 'preview', render: (x) => { const e = warrantyEnd(x); return `<span class="small">${e ? 'Warranty ends on <b>' + fmtDate(e) + '</b>' : 'Enter warranty months or an end date.'}</span>`; } },
        { name: 'bill', label: bill ? 'Replace bill / invoice photo' : 'Bill / invoice photo or PDF', type: 'file', accept: 'image/*,application/pdf' },
        { name: 'service', label: 'Service centre / helpline', placeholder: 'e.g. 1800-xxx' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSave: (v) => {
        if (!(v.product || '').trim()) return 'Enter the product';
        const rec = { product: v.product.trim(), brand: (v.brand || '').trim(), model: (v.model || '').trim(), serial: (v.serial || '').trim(), purchaseDate: v.purchaseDate || '', price: num(v.price) || '', store: (v.store || '').trim(), months: num(v.months) || '', extendedMonths: num(v.extendedMonths) || '', expiry: v.expiry || '', service: (v.service || '').trim(), notes: (v.notes || '').trim() };
        let rw = w;
        if (w) Object.assign(w, rec); else { rw = { id: uid(), billDocId: '', ...rec }; S.warranties.push(rw); }
        save(); toast('Saved');
        if (v.bill && v.bill.length) {
          const end = warrantyEnd(rw);
          addDocuments(v.bill.slice(0, 1), { name: `Bill: ${rec.product}`, category: 'Bills & Receipts', expiry: end, notes: `Warranty${end ? ' until ' + fmtDate(end) : ''}${rec.serial ? ' · S/N ' + rec.serial : ''}`, compress: true, quiet: true }).then((ids) => {
            if (!ids[0]) return;
            const old = rw.billDocId && S.documents.find((d) => d.id === rw.billDocId);
            if (old) deleteDocument(old);
            rw.billDocId = ids[0]; save(); render(); toast('Bill attached');
          }).catch((e) => alert('Could not save bill: ' + e.message));
        }
        return true;
      },
      extra: bill ? [{ label: '🧾 View bill', act: () => { openDocument(bill); return false; } }] : [],
      onDelete: w ? () => { if (!confirm('Delete this product?' + (bill ? ' Its bill stays in Docs.' : ''))) return false; S.warranties = S.warranties.filter((x) => x.id !== w.id); save(); return true; } : null,
    });
  }

  // ---------- Vehicles ----------
  const VEH_TYPES = { car: '🚗', bike: '🏍️', scooter: '🛵', other: '🚙' };
  function vehicleStats(v) {
    const logs = v.logs || [];
    const fuel = logs.filter((l) => l.kind === 'fuel' && num(l.odo) > 0).sort((a, b) => num(a.odo) - num(b.odo) || a.date.localeCompare(b.date));
    let lastFull = -1, acc = 0, totD = 0, totL = 0, last = null;
    fuel.forEach((l, i) => {
      if (lastFull >= 0) acc += num(l.litres);
      if (l.full !== false) {
        if (lastFull >= 0) { const d = num(l.odo) - num(fuel[lastFull].odo); if (d > 0 && acc > 0) { totD += d; totL += acc; last = d / acc; } }
        lastFull = i; acc = 0;
      }
    });
    const odos = logs.map((l) => num(l.odo)).filter((x) => x > 0);
    const odo = Math.max(num(v.odometer), ...odos, 0);
    const fuelCost = sum(logs.filter((l) => l.kind === 'fuel'));
    const allCost = sum(logs);
    const minOdo = odos.length ? Math.min(...odos) : 0;
    const month = iso().slice(0, 7);
    const lastService = logs.filter((l) => l.kind === 'service').sort((a, b) => b.date.localeCompare(a.date))[0];
    return { avg: totL ? totD / totL : null, last, odo, fuelCost, allCost, costPerKm: odo - minOdo > 0 ? fuelCost / (odo - minOdo) : null,
      monthSpend: sum(logs.filter((l) => l.date.slice(0, 7) === month)), lastService, unit: v.fuelType === 'ev' ? 'km/kWh' : v.fuelType === 'cng' ? 'km/kg' : 'km/l' };
  }
  function vehicleDues(v) {
    const t = today0(); const out = [];
    const st = vehicleStats(v);
    const pol = S.policies.find((p) => p.type === 'vehicle' && policyActive(p) && v.regNo && (p.vehicleNumber || '').replace(/\s/g, '').toLowerCase() === v.regNo.replace(/\s/g, '').toLowerCase());
    const insDate = pol ? (pol.nextDue || pol.endDate) : v.insuranceDue;
    if (insDate) out.push({ k: 'Insurance', date: insDate, days: daysBetween(t, parseDate(insDate)), policyId: pol && pol.id });
    if (v.pucDue) out.push({ k: 'PUC', date: v.pucDue, days: daysBetween(t, parseDate(v.pucDue)) });
    if (v.serviceDue) out.push({ k: 'Service', date: v.serviceDue, days: daysBetween(t, parseDate(v.serviceDue)) });
    if (num(v.serviceDueKm) > 0 && st.odo) out.push({ k: 'Service', km: num(v.serviceDueKm) - st.odo, days: num(v.serviceDueKm) - st.odo <= 300 ? 0 : 999 });
    return out;
  }
  function vehicleItem(v) {
    const s = vehicleStats(v);
    const soon = vehicleDues(v).filter((d) => d.days <= 15);
    return `<button class="item" data-act="open-vehicle" data-id="${v.id}"><div class="avatar">${VEH_TYPES[v.type] || '🚗'}</div>
      <div class="grow"><div class="title ellipsis">${esc(v.name)}${v.regNo ? ' · ' + esc(v.regNo.toUpperCase()) : ''}</div>
      <div class="sub ellipsis">${soon.length ? soon.map((d) => `<span class="badge warn">${d.k}${d.km !== undefined ? ' in ' + Math.max(0, d.km) + ' km' : d.days < 0 ? ' overdue' : ' ' + d.days + 'd'}</span>`).join(' ') + ' ' : ''}${s.avg ? s.avg.toFixed(1) + ' ' + s.unit + ' avg' : 'Add fuel fill-ups to see mileage'}</div></div>
      <div class="right"><b>${s.odo ? s.odo.toLocaleString('en-IN') + ' km' : ''}</b></div></button>`;
  }
  function viewVehicles() {
    return `<p class="small muted" style="margin-top:0">Track fuel & mileage, service history, and insurance / PUC / service due dates.</p>
      <div class="row" style="margin-bottom:12px"><div class="grow"></div><button class="btn primary" data-act="add-vehicle">+ Vehicle</button></div>
      ${S.vehicles.length ? `<div class="list">${S.vehicles.map(vehicleItem).join('')}</div>` : '<div class="list"><div class="empty"><div class="em">🚗</div>Add your car, bike or scooter.</div></div>'}`;
  }
  function viewVehicle(id) {
    const v = S.vehicles.find((x) => x.id === id);
    if (!v) { st.sub = null; return viewMore(); }
    const s = vehicleStats(v);
    const dues = vehicleDues(v);
    const logs = [...(v.logs || [])].sort((a, b) => b.date.localeCompare(a.date) || num(b.odo) - num(a.odo));
    const icon = { fuel: '⛽', service: '🔧', other: '🧾' };
    return `<div class="card hero"><div class="label">${VEH_TYPES[v.type] || '🚗'} ${esc(v.name)}${v.regNo ? ' · ' + esc(v.regNo.toUpperCase()) : ''}</div>
      <div class="big">${s.avg ? s.avg.toFixed(1) + ' <span style="font-size:18px">' + s.unit + '</span>' : '—'}</div>
      <div class="split"><div><small>Last fill-up</small><b>${s.last ? s.last.toFixed(1) + ' ' + s.unit : '—'}</b></div><div><small>Odometer</small><b>${s.odo ? s.odo.toLocaleString('en-IN') + ' km' : '—'}</b></div></div></div>
      <div class="grid3" style="margin-bottom:14px"><div class="stat"><small>This month</small><b>${money(s.monthSpend)}</b></div><div class="stat"><small>Fuel cost / km</small><b>${s.costPerKm ? money(s.costPerKm) : '—'}</b></div><div class="stat"><small>Total spent</small><b>${money(s.allCost)}</b></div></div>
      <div class="btn-row" style="margin-bottom:14px"><button class="btn primary" data-act="veh-log" data-id="${v.id}" data-kind="fuel">⛽ Fuel</button><button class="btn" data-act="veh-log" data-id="${v.id}" data-kind="service">🔧 Service</button><button class="btn" data-act="veh-log" data-id="${v.id}" data-kind="other">🧾 Other</button></div>
      <div class="card"><h2 class="row"><span class="grow">Due dates</span><button class="link" data-act="edit-vehicle" data-id="${v.id}">Edit</button></h2>
        ${dues.length ? dues.map((d) => `<div class="kv"><span>${d.k}${d.policyId ? ' (policy)' : ''}</span><span class="val">${d.km !== undefined ? (d.km <= 0 ? `<span class="badge warn">Due now</span> at ${num(v.serviceDueKm).toLocaleString('en-IN')} km` : `in ${d.km.toLocaleString('en-IN')} km`) : `${d.days < 0 ? '<span class="badge warn">Overdue</span> ' : d.days <= 15 ? `<span class="badge warn">${d.days}d</span> ` : ''}${fmtDate(d.date)}`}</span></div>`).join('')
          : '<div class="small muted">Add insurance, PUC and service due dates in “Edit”. A vehicle insurance policy with the same number is picked up automatically.</div>'}
        ${s.lastService ? kv('Last service', `${fmtDate(s.lastService.date)}${s.lastService.odo ? ' · ' + num(s.lastService.odo).toLocaleString('en-IN') + ' km' : ''}`) : ''}</div>
      <div class="section-title">Log</div>
      ${logs.length ? `<div class="list">${logs.map((l) => `<button class="item" data-act="veh-log" data-id="${v.id}" data-log="${l.id}"><div class="avatar">${icon[l.kind] || '🧾'}</div>
        <div class="grow"><div class="title">${l.kind === 'fuel' ? `${num(l.litres) ? num(l.litres) + (v.fuelType === 'ev' ? ' kWh' : v.fuelType === 'cng' ? ' kg' : ' L') : 'Fuel'}${l.full === false ? ' (partial)' : ''}` : esc(l.note || (l.kind === 'service' ? 'Service' : 'Expense'))}</div>
        <div class="sub">${fmtDate(l.date)}${num(l.odo) ? ' · ' + num(l.odo).toLocaleString('en-IN') + ' km' : ''}${l.kind === 'fuel' && num(l.litres) && num(l.amount) ? ' · ' + fmt(num(l.amount) / num(l.litres)) + '/unit' : ''}</div></div>
        <div class="right"><b>${money(l.amount)}</b></div></button>`).join('')}</div>` : '<div class="list"><div class="empty">Log fill-ups with the odometer reading. Mileage is worked out between two full-tank fill-ups.</div></div>'}`;
  }
  function vehicleForm(v) {
    openForm({
      title: v ? 'Edit vehicle' : 'New vehicle',
      values: v ? { ...v } : { type: 'car', fuelType: 'petrol' },
      fields: () => [
        { name: 'type', type: 'segment', options: [['car', '🚗 Car'], ['bike', '🏍️ Bike'], ['scooter', '🛵 Scooter'], ['other', 'Other']] },
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Swift, Activa' },
        { name: 'regNo', label: 'Registration no.', half: true, placeholder: 'MH12AB1234' },
        { name: 'fuelType', label: 'Fuel', type: 'select', half: true, options: [['petrol', 'Petrol'], ['diesel', 'Diesel'], ['cng', 'CNG'], ['ev', 'Electric']] },
        { name: 'model', label: 'Make / model / year', placeholder: 'e.g. Maruti Swift ZXi 2022' },
        { name: 'odometer', label: 'Current odometer (km)', type: 'number', half: true },
        { name: 'insuranceDue', label: 'Insurance renewal', type: 'date', half: true, help: 'Or add it under Wealth → Insurance as a Vehicle policy with this number.' },
        { name: 'pucDue', label: 'PUC valid till', type: 'date', half: true },
        { name: 'serviceDue', label: 'Next service date', type: 'date', half: true },
        { name: 'serviceDueKm', label: 'Next service at (km)', type: 'number', half: true },
        { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Chassis no., service centre, FASTag…' },
      ],
      onSave: (x) => {
        if (!(x.name || '').trim()) return 'Enter a name';
        const rec = { type: x.type || 'car', name: x.name.trim(), regNo: (x.regNo || '').trim().toUpperCase(), fuelType: x.fuelType, model: (x.model || '').trim(), odometer: num(x.odometer) || '', insuranceDue: x.insuranceDue || '', pucDue: x.pucDue || '', serviceDue: x.serviceDue || '', serviceDueKm: num(x.serviceDueKm) || '', notes: (x.notes || '').trim() };
        if (v) Object.assign(v, rec); else S.vehicles.push({ id: uid(), logs: [], ...rec });
        save(); toast('Vehicle saved'); return true;
      },
      onDelete: v ? () => { if (!confirm('Delete this vehicle and its log? Expense entries already recorded are kept.')) return false; S.vehicles = S.vehicles.filter((y) => y.id !== v.id); save(); st.sub = null; return true; } : null,
    });
  }
  function vehicleLogForm(v, kind, l) {
    const accs = S.accounts.filter((a) => !a.archived);
    const linked = l && l.txnId ? S.transactions.find((t) => t.id === l.txnId) : null;
    const s = vehicleStats(v);
    const lastFuelAcc = ([...(v.logs || [])].reverse().find((x) => x.txnId && S.transactions.some((t) => t.id === x.txnId)) || {}).txnId;
    const defAcc = lastFuelAcc ? S.transactions.find((t) => t.id === lastFuelAcc).accountId : defaultPayAccount();
    openForm({
      title: l ? 'Edit log' : kind === 'fuel' ? 'Fuel fill-up' : kind === 'service' ? 'Service' : 'Vehicle expense',
      values: l ? { ...l, accountId: linked ? linked.accountId : '', mode: linked ? linked.mode : 'upi', _touched_mode: true } : { kind, date: iso(), odo: '', full: true, accountId: defAcc, mode: 'upi', _touched_mode: true },
      fields: (x) => [
        { name: 'kind', type: 'segment', options: [['fuel', '⛽ Fuel'], ['service', '🔧 Service'], ['other', '🧾 Other']] },
        { name: 'amount', label: 'Amount', type: 'number', big: true },
        ...(x.kind === 'fuel' ? [{ name: 'litres', label: v.fuelType === 'ev' ? 'Units (kWh)' : v.fuelType === 'cng' ? 'Kg' : 'Litres', type: 'number', half: true }] : []),
        { name: 'odo', label: 'Odometer (km)', type: 'number', half: x.kind === 'fuel', help: s.odo ? `Last reading ${s.odo.toLocaleString('en-IN')} km` : '' },
        ...(x.kind === 'fuel' ? [{ name: 'full', label: 'Filled the tank full (needed for mileage)', type: 'checkbox' }] : [{ name: 'note', label: 'What was done', placeholder: x.kind === 'service' ? 'e.g. 20,000 km service, oil change' : 'e.g. Toll, Wash, Tyre, Repair, Parking' }]),
        { name: 'date', label: 'Date', type: 'date' },
        ...(x.kind === 'service' ? [{ name: 'nextDate', label: 'Next service date', type: 'date', half: true }, { name: 'nextKm', label: 'Next service at (km)', type: 'number', half: true }] : []),
        { name: 'accountId', label: 'Paid from (also records an expense entry)', type: 'select', options: [['', 'Don’t record in an account'], ...accs.map((a) => [a.id, `${accIcon(a)} ${a.name}`])] },
        { name: 'mode', label: 'Paid by', type: 'segment', options: PAY_MODES },
      ],
      onSave: (x) => {
        if (!(num(x.amount) > 0)) return 'Enter the amount';
        if (x.kind === 'fuel' && !(num(x.litres) > 0)) return 'Enter the litres / units';
        if (num(x.odo) && s.odo && num(x.odo) < s.odo - 5000 && !l) return 'Odometer looks lower than the last reading';
        const rec = { id: l ? l.id : uid(), kind: x.kind, amount: num(x.amount), litres: x.kind === 'fuel' ? num(x.litres) : '', odo: num(x.odo) || '', full: x.kind === 'fuel' ? !!x.full : undefined, note: x.kind === 'fuel' ? '' : (x.note || '').trim(), date: x.date || iso(), txnId: l ? l.txnId || '' : '' };
        const cat = x.kind === 'fuel' ? 'Fuel' : 'Vehicle';
        if (x.accountId) {
          ensureCat('expense', cat);
          const tx = { type: 'expense', amount: rec.amount, accountId: x.accountId, toAccountId: '', category: cat, mode: x.mode || '', note: `${v.name}${rec.note ? ' — ' + rec.note : x.kind === 'fuel' ? ' — fuel ' + rec.litres + (v.fuelType === 'ev' ? ' kWh' : ' L') : ''}`, date: rec.date, vehicleId: v.id };
          const ex = rec.txnId && S.transactions.find((t) => t.id === rec.txnId);
          if (ex) Object.assign(ex, tx); else { rec.txnId = uid(); S.transactions.push({ id: rec.txnId, created: new Date().toISOString(), ...tx }); }
        } else if (rec.txnId) { S.transactions = S.transactions.filter((t) => t.id !== rec.txnId); rec.txnId = ''; }
        if (rec.full === undefined) delete rec.full;
        v.logs = (v.logs || []).filter((y) => y.id !== rec.id).concat(rec);
        if (x.kind === 'service') { if (x.nextDate) v.serviceDue = x.nextDate; if (num(x.nextKm)) v.serviceDueKm = num(x.nextKm); }
        if (num(x.odo) > num(v.odometer)) v.odometer = num(x.odo);
        save(); toast('Saved'); return true;
      },
      onDelete: l ? () => {
        if (!confirm('Delete this log entry?' + (l.txnId ? ' The linked expense entry is removed too.' : ''))) return false;
        v.logs = v.logs.filter((y) => y.id !== l.id);
        if (l.txnId) S.transactions = S.transactions.filter((t) => t.id !== l.txnId);
        save(); return true;
      } : null,
    });
  }

  // ---------- Global search ----------
  function docItem(d) {
    return `<button class="item" data-act="open-doc" data-id="${d.id}"><div class="avatar">${docIcon(d)}</div><div class="grow"><div class="title ellipsis">${esc(d.name)}</div><div class="sub ellipsis">${esc(d.category)} · ${fmtSize(d.size)}</div></div>${ICON.chev}</button>`;
  }
  function searchAll(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const digits = q.replace(/[₹,\s]/g, '');
    const isNum = /^\d+(\.\d+)?$/.test(digits);
    const has = (...f) => f.filter(Boolean).join(' ').toLowerCase().includes(q);
    const groups = [];
    const add = (title, list, render, limit = 6) => { if (list.length) groups.push({ title, count: list.length, html: list.slice(0, limit).map(render).join('') }); };
    const bal = balances();
    add('Entries', S.transactions.filter((t) => (isNum && (String(t.amount) === digits || Math.abs(num(t.amount) - num(digits)) < 0.005 || String(Math.round(num(t.amount))).startsWith(digits) && digits.length >= 3))
      || has(t.category, t.note, accName(t.accountId), t.toAccountId && accName(t.toAccountId), MODE_LABEL[t.mode])).sort((a, b) => b.date.localeCompare(a.date)), (t) => txnRow(t), 25);
    add('Accounts', S.accounts.filter((a) => has(a.name, a.bankName, a.accountNumber, a.ifsc, a.branch, a.holder, a.upi, a.cardLast4, a.nominee, a.notes)), (a) => accItem(a, bal[a.id] || 0));
    add('Fixed deposits', S.fds.filter((f) => has(f.bank, f.fdNumber, f.holder, f.nominee, f.notes) || (isNum && num(f.principal) === num(digits))), (f) => fdItem(f, fdCalc(f)));
    add('PPF', S.ppf.filter((p) => has('ppf', p.holder, p.bank, p.accountNumber, p.nominee, p.notes)), ppfItem);
    add('Insurance', S.policies.filter((p) => has(p.insurer, p.planName, p.policyNumber, p.insured, p.vehicleNumber, p.nominee, p.agentName, p.notes, (POLICY_TYPES[p.type] || [])[0], 'insurance')), policyItem);
    add('Documents', S.documents.filter((d) => has(d.name, d.category, d.notes, d.fileName, d.text)), docItem);
    add('Bills & subscriptions', S.bills.filter((b) => has(b.name, b.category, b.consumerNo, b.notes, b.kind)), billItem);
    add('Warranties', S.warranties.filter((w) => has(w.product, w.brand, w.model, w.serial, w.store, w.notes, 'warranty')), warrantyItem);
    add('Vehicles', S.vehicles.filter((v) => has(v.name, v.regNo, v.model, v.notes)), vehicleItem);
    add('Assets & loans', S.assets.filter((x) => has(x.name, x.category, x.notes)), (x) => `<button class="item" data-act="edit-asset" data-id="${x.id}"><div class="avatar">${x.kind === 'liability' ? '📉' : '📈'}</div><div class="grow"><div class="title ellipsis">${esc(x.name)}</div><div class="sub">${esc(x.category || '')}</div></div><b>${money(x.value)}</b></button>`);
    add('Goals', S.goals.filter((g) => has(g.name, g.notes)), (g) => goalItem(g, bal));
    add('Emergency contacts', (S.emergency.contacts || []).filter((c) => has(c.name, c.relation, c.phone, c.note)), (c) => `<a class="item" href="tel:${esc((c.phone || '').replace(/[^\d+]/g, ''))}"><div class="avatar">📞</div><div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${esc([c.relation, c.phone].filter(Boolean).join(' · '))}</div></div></a>`);
    return groups;
  }
  function viewSearch() {
    const q = st.filter.gq || '';
    const groups = searchAll(q);
    const total = groups.reduce((s, g) => s + g.count, 0);
    return `<div class="filters" style="grid-template-columns:1fr"><input type="search" data-filter="gq" id="gsearch" placeholder="Search everything — name, amount, account no., policy no…" value="${esc(q)}" autocomplete="off"></div>
      ${q.trim().length < 2 ? `<div class="empty"><div class="em">🔎</div>Search across entries, accounts, FDs, PPF, insurance, documents, bills, warranties and vehicles.<br><span class="small">Try a merchant (“swiggy”), an amount (“1890”), a policy number or “passport”.</span></div>`
        : !total ? `<div class="empty">No results for “${esc(q)}”.</div>`
          : groups.map((g) => `<div class="section-title">${esc(g.title)}<span class="muted small">${g.count}</span></div><div class="list">${g.html}</div>`).join('')}`;
  }

  // =====================================================================
  // v1.6: read FD receipts & insurance papers on the device and pre-fill forms
  // (pdf.js for digital PDFs, Tesseract OCR for photos/scans; nothing leaves the phone)
  // =====================================================================
  const absUrl = (p) => new URL(p, location.href).href;
  let ocrWorkerP = null, ocrProgress = null;
  async function getOcr() {
    if (!window.Tesseract) await loadScript('vendor/ocr/tesseract.min.js');
    if (!ocrWorkerP) {
      ocrWorkerP = Tesseract.createWorker('eng', 1, {
        workerPath: absUrl('vendor/ocr/worker.min.js'), corePath: absUrl('vendor/ocr/'), langPath: absUrl('vendor/ocr/'),
        workerBlobURL: false, gzip: false, logger: (m) => ocrProgress && ocrProgress(m),
      }).catch((e) => { ocrWorkerP = null; throw e; });
    }
    return ocrWorkerP;
  }
  async function ocrImage(src) {
    const w = await getOcr();
    const { data } = await w.recognize(src);
    return data.text || '';
  }
  async function loadPdfJs() {
    if (!window.pdfjsLib) {
      await loadScript('vendor/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = absUrl('vendor/pdf.worker.min.js');
    }
    return window.pdfjsLib;
  }
  async function pdfToText(buf, step) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: buf }).promise;
    const n = Math.min(pdf.numPages, 4);
    let out = '';
    for (let i = 1; i <= n; i++) {
      step(`Reading page ${i} of ${n}…`, (i - 1) / n);
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5], x = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - y) < 3.5);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || 0, s: it.str });
      });
      rows.sort((a, b) => b.y - a.y).forEach((r) => {
        r.items.sort((a, b) => a.x - b.x);
        let line = '', end = null;
        r.items.forEach((it) => { line += (end !== null ? (it.x - end > 12 ? '   ' : (line.endsWith(' ') || it.s.startsWith(' ') ? '' : ' ')) : '') + it.s; end = it.x + it.w; });
        out += line + '\n';
      });
    }
    if (out.replace(/\s/g, '').length >= 60) return [out];
    // Scanned PDF: render pages and run OCR
    let ocrA = '', ocrB = '';
    for (let i = 1; i <= Math.min(n, 2); i++) {
      step(`Scanning page ${i}…`, 0.2);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2.2 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      ocrA += (await ocrImage(enhanceForOcr(c, c.width, c.height))) + '\n';
      step(`Double-checking page ${i}…`, 0.6);
      ocrB += (await ocrImage(c)) + '\n';
    }
    return [ocrA, ocrB];
  }
  // Even out lighting/shadows and boost contrast (like a scanner app) before OCR.
  function enhanceForOcr(src, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    // Background estimate: shrink a lot, then stretch back (a fast large blur)
    const sw = Math.max(8, Math.round(w / 28)), sh = Math.max(8, Math.round(h / 28));
    const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
    const sg = sm.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(c, 0, 0, sw, sh);
    const bgc = document.createElement('canvas'); bgc.width = w; bgc.height = h;
    const bg = bgc.getContext('2d', { willReadFrequently: true }); bg.imageSmoothingQuality = 'high'; bg.drawImage(sm, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), back = bg.getImageData(0, 0, w, h).data, d = img.data;
    const gray = new Float32Array(w * h);
    let lo = 255, hi = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const b = Math.max(40, 0.299 * back[i] + 0.587 * back[i + 1] + 0.114 * back[i + 2]);
      const n = Math.min(255, (v / b) * 255);
      gray[j] = n; if (n < lo) lo = n; if (n > hi) hi = n;
    }
    const span = Math.max(30, hi - lo);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let n = ((gray[j] - lo) / span) * 255;

      d[i] = d[i + 1] = d[i + 2] = n;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // Two versions of a photo: as-is (scaled) and lighting-corrected. Both are read and the results combined.
  async function imagesForOcr(file) {
    try {
      const bmp = await createImageBitmap(file);
      const big = Math.max(bmp.width, bmp.height);
      const sc = big > 2800 ? 2800 / big : big < 1800 ? Math.min(2, 2000 / big) : 1;
      const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
      const plain = document.createElement('canvas'); plain.width = w; plain.height = h;
      const g = plain.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h);
      return [enhanceForOcr(bmp, w, h), plain];
    } catch (e) { console.warn('enhance failed', e); return [file]; }
  }
  async function extractTexts(file, step) {
    if (/pdf/.test(file.type) || /\.pdf$/i.test(file.name || '')) return pdfToText(await file.arrayBuffer(), step);
    if (/^image\//.test(file.type)) {
      const imgs = await imagesForOcr(file), out = [];
      for (let i = 0; i < imgs.length; i++) { step(i ? 'Double-checking…' : 'Recognising text in the photo…', 0.05); out.push(await ocrImage(imgs[i])); }
      return out;
    }
    if (/^text\//.test(file.type)) return [await file.text()];
    throw new Error('Only PDF files and photos can be read.');
  }
  const extractText = async (file, step) => (await extractTexts(file, step)).join('\n');

  // ---------- Text helpers ----------
  const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
  const DATE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\/\\-. ]{1,2}(\\d{1,2}|(?:${MON})[a-z]*)[\\/\\-., ]{1,3}(\\d{4}|\\d{2})\\b|\\b(\\d{4})[\\-\\/.](\\d{1,2})[\\-\\/.](\\d{1,2})\\b|\\b(${MON})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi');
  const MONIDX = (m) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.slice(0, 3).toLowerCase());
  function datesIn(str) {
    const out = []; let m; DATE_RE.lastIndex = 0;
    while ((m = DATE_RE.exec(str || ''))) {
      let y, mo, d;
      if (m[1]) { d = +m[1]; mo = isNaN(m[2]) ? MONIDX(m[2]) : +m[2] - 1; y = +m[3]; }
      else if (m[4]) { y = +m[4]; mo = +m[5] - 1; d = +m[6]; }
      else { mo = MONIDX(m[7]); d = +m[8]; y = +m[9]; }
      if (y < 100) y += 2000;
      if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1990 || y > 2100) continue;
      const dt = new Date(y, mo, d);
      if (dt.getMonth() === mo) out.push(iso(dt));
    }
    if (!out.length) { // OCR often reads "/" as 1, l or |: 05112/2026, 0511212026
      const re = /\b(\d{2})[1l|I\/\-.](\d{2})[1l|I\/\-.](20\d{2})\b/g; let x;
      while ((x = re.exec(str || ''))) { const dt = new Date(+x[3], +x[2] - 1, +x[1]); if (+x[2] >= 1 && +x[2] <= 12 && dt.getDate() === +x[1]) out.push(iso(dt)); }
    }
    return out;
  }
  const stripNoise = (s) => String(s || '').replace(DATE_RE, ' ').replace(/\b\d{1,3}(?:\.\d+)?\s*%/g, ' ').replace(/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, ' ').replace(/\b1800[\s-]?\d{2,4}[\s-]?\d{3,4}\b/g, ' ');
  const parseAmt = (tok) => { // 2,50,000.00 · OCR slips: 2,50.000.00 · 2.78 567 00 · 1.00.00.000
    const groups = tok.split(/[,. ]/);
    let dec = '';
    if (groups.length > 1 && groups[groups.length - 1].length === 2) dec = groups.pop();
    if (groups.length > 1) {
      const lens = groups.map((g) => g.length);
      const indian = lens[lens.length - 1] === 3 && lens.slice(1, -1).every((l) => l === 2) && lens[0] <= 2;
      const intl = lens.slice(1).every((l) => l === 3) && lens[0] <= 3;
      if (!indian && !intl) return NaN;
    }
    return Number(groups.join('') + (dec ? '.' + dec : ''));
  };
  const exAmt = (s) => {
    const t = stripNoise(s).replace(/(\d)\s+(?=[,.]\d)/g, '$1');
    const re = /(?:rs\.?|inr|₹|rupees)?\s*(\d{1,3}(?:[,. ]\d{2,3})+(?:[., ]\d{2})?|\d{3,}(?:\.\d{1,2})?)(?![\d\/])/gi;
    let m; while ((m = re.exec(t))) { const v = parseAmt(m[1]); if (v >= 100 && v < 1e11) return v; }
    return null;
  };
  const exDate = (s) => datesIn(s)[0] || null;
  const exPct = (s) => {
    const t = String(s || '');
    const m = t.match(/(\d{1,2}(?:\.\d{1,3})?)\s*%/) || t.match(/^[\s:.\-–]*(\d{1,2}\.\d{1,3})\b/);
    if (m) { const v = num(m[1]); if (v > 0 && v < 25) return v; }
    const lost = t.match(/\b(\d{3})\s*%/); // "725%" → 7.25 (decimal point lost)
    if (lost) { const v = num(lost[1]) / 100; if (v > 1 && v < 15) return v; }
    return null;
  };
  const exToken = (s) => { const m = String(s || '').replace(/^[\s:.\-–#]+/, '').match(/\b([A-Z0-9][A-Z0-9\/\-]{4,29})\b/i); return m && /\d/.test(m[1]) ? m[1] : null; };
  const exText = (s) => {
    let t = String(s || '').replace(/^[\s:.\-–|]+/, '').split(/\s{3,}|\s\|\s|\t/)[0].trim();
    t = t.replace(/\s+(?:[A-Z][a-z]+\s?){1,3}:.*$/, '').trim();
    if (!/[a-z]{2}/i.test(t) || /^(yes|no|na|n\/a|nil|none|-+|registered|not registered)$/i.test(t)) return null;
    return t.slice(0, 60);
  };
  const exTenure = (s) => {
    const t = String(s || '').toLowerCase();
    const y = t.match(/(\d{1,2})\s*(?:years?|yrs?|y)\b/), mo = t.match(/(\d{1,3})\s*(?:months?|mths?|m)\b/), d = t.match(/(\d{1,4})\s*(?:days?|d)\b/);
    if (!y && !mo && !d) return null;
    return { months: (y ? +y[1] * 12 : 0) + (mo ? +mo[1] : 0), days: d ? +d[1] : 0 };
  };
  function findField(lines, labels, ex, opts = {}) {
    for (const re of [].concat(labels)) {
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        if (opts.skip && opts.skip.test(L)) continue;
        const m = L.match(re);
        if (!m) continue;
        let v = ex(L.slice(m.index + m[0].length));
        if ((v === null || v === undefined || v === '') && opts.next !== false) v = ex(lines[i + 1] || '');
        if (v !== null && v !== undefined && v !== '') return v;
      }
    }
    return null;
  }
  const pickFirst = (text, list) => {
    let best = null;
    list.forEach(([name, re]) => { const m = text.match(re); if (m && (best === null || m.index < best.i)) best = { name, i: m.index }; });
    return best ? best.name : '';
  };
  const BANKS = [['SBI', /state bank of india|\bsbi\b/i], ['HDFC Bank', /hdfc bank/i], ['ICICI Bank', /icici bank/i], ['Axis Bank', /axis bank/i], ['Kotak Mahindra Bank', /kotak mahindra bank|\bkotak\b/i],
    ['Punjab National Bank', /punjab national bank|\bpnb\b/i], ['Bank of Baroda', /bank of baroda/i], ['Canara Bank', /canara bank/i], ['Union Bank of India', /union bank/i], ['Central Bank of India', /central bank of india/i],
    ['Indian Overseas Bank', /indian overseas bank/i], ['Indian Bank', /\bindian bank\b/i], ['Bank of India', /\bbank of india\b/i], ['Bank of Maharashtra', /bank of maharashtra/i], ['UCO Bank', /\buco bank/i],
    ['IDFC FIRST Bank', /idfc/i], ['IndusInd Bank', /indusind/i], ['Yes Bank', /\byes bank/i], ['Federal Bank', /federal bank/i], ['IDBI Bank', /\bidbi\b/i], ['RBL Bank', /\brbl bank/i], ['Bandhan Bank', /bandhan bank/i],
    ['AU Small Finance Bank', /au small finance/i], ['Equitas SFB', /equitas/i], ['Ujjivan SFB', /ujjivan/i], ['Suryoday SFB', /suryoday/i], ['Post Office', /post office|india post|department of posts/i],
    ['Bajaj Finance', /bajaj finance/i], ['Shriram Finance', /shriram/i], ['Mahindra Finance', /mahindra finance/i], ['South Indian Bank', /south indian bank/i], ['Karnataka Bank', /karnataka bank/i], ['DCB Bank', /\bdcb bank/i]];
  const INSURERS_RE = [['LIC', /life insurance corporation|\blic of india|\blic\b/i], ['HDFC Life', /hdfc life/i], ['HDFC ERGO', /hdfc ergo/i], ['ICICI Prudential', /icici pru/i], ['ICICI Lombard', /icici lombard/i],
    ['SBI Life', /sbi life/i], ['SBI General', /sbi general/i], ['Axis Max Life', /max life|axis max/i], ['Tata AIA', /tata aia/i], ['Tata AIG', /tata aig/i], ['Bajaj Allianz', /bajaj allianz|bajaj general|bajaj life/i],
    ['Star Health', /star health/i], ['Niva Bupa', /niva bupa|max bupa/i], ['Care Health', /care health|religare health/i], ['Digit', /go digit|digit (?:general )?insurance/i], ['Acko', /\backo\b/i],
    ['New India Assurance', /new india assurance/i], ['United India', /united india/i], ['Oriental Insurance', /oriental insurance/i], ['National Insurance', /national insurance/i], ['Kotak Life', /kotak (?:mahindra )?life/i],
    ['Kotak General', /kotak (?:mahindra )?general/i], ['Aditya Birla', /aditya birla/i], ['Reliance', /reliance (?:general|nippon)/i], ['Future Generali', /future generali/i], ['ManipalCigna', /manipal ?cigna/i],
    ['PNB MetLife', /metlife/i], ['Canara HSBC Life', /canara hsbc/i], ['Royal Sundaram', /royal sundaram/i], ['IFFCO Tokio', /iffco/i], ['Chola MS', /cholamandalam|chola ms/i], ['Liberty General', /liberty general/i],
    ['Universal Sompo', /universal sompo/i], ['Zurich Kotak', /zurich kotak/i], ['Zuno', /\bzuno\b|edelweiss general/i], ['Bharti AXA', /bharti axa/i], ['Magma HDI', /magma/i], ['Navi General', /navi general/i], ['Bandhan Life', /bandhan life|aegon life/i]];
  function tenureBetween(a, b) {
    const s = parseDate(a), e = parseDate(b);
    let m = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth();
    let t = addTenure(s, m, 0);
    if (t > e) { m--; t = addTenure(s, m, 0); }
    return { months: Math.max(0, m), days: Math.max(0, daysBetween(t, e)) };
  }
  const toLines = (text) => String(text || '').split(/\r?\n/).map((l) => l.replace(/[ \t]{3,}/g, '   ').replace(/[ \t]{1,2}/g, ' ').trim()).filter(Boolean);

  function detectKind(text) {
    const t = text.toLowerCase();
    const sc = (res) => res.reduce((s, re) => s + (re.test(t) ? 1 : 0), 0);
    const fd = sc([/fixed deposit/, /term deposit/, /\bf\.?d\.?\b/, /\bfdr\b|\btdr\b|\bstdr\b/, /maturity (?:value|amount)/, /rate of (?:interest|ierest|lnterest)|interest rate|%\s*p\.?\s*a/, /deposit (?:amount|date|no)/, /principal/, /date of deposit|value date/, /maturity date/, /reinvestment|cumulative|interest payout/]);
    const ins = sc([/\bpolicy\b/, /insured/, /insurance/, /premium/, /sum (?:assured|insured)/, /policy (?:no|number|period|schedule)/, /\bidv\b/, /proposer/, /life assured/, /cover/]);
    return { kind: ins >= 3 && ins > fd ? 'policy' : fd >= 3 || (fd >= 2 && ins === 0) ? 'fd' : ins >= 3 ? 'policy' : '', fd, ins };
  }

  function parseFdText(text) {
    const lines = toLines(text), low = text.toLowerCase(), r = {};
    r.bank = pickFirst(text, BANKS);
    r.fdNumber = findField(lines, [/(?:fd|fdr|tdr|stdr|term deposit|fixed deposit|deposit)\s*(?:a\/c|account)?\s*(?:no\.?|number|#)/i, /(?:receipt|certificate)\s*(?:no\.?|number)/i, /(?:account|a\/c)\s*(?:no\.?|number)/i], exToken);
    r.principal = findField(lines, [/principal\s*(?:amount|amt)?/i, /deposit\s*(?:amount|amt|value)/i, /amount\s*of\s*(?:the\s*)?deposit/i, /amount\s*deposited|investment\s*amount|amount\s*invested/i, /^amount\b/i], exAmt, { skip: /maturity|interest\s*(?:amount|earned|payable)/i });
    r.rate = findField(lines, [/rate\s*of\s*(?:interest|ierest|lnterest)|interest\s*rate|\broi\b|rate\s*\(?%\s*p\.?a|rate\s*p\.?\s*a/i], exPct) || (low.match(/(\d{1,2}(?:\.\d{1,3})?)\s*%\s*(?:p\.?\s*a|per annum)/) || [])[1] || null;
    r.startDate = findField(lines, [/date\s*of\s*(?:deposit|issue|opening|investment)/i, /(?:deposit|value|start|open(?:ing)?|issue|effective|booking|investment|creation)\s*date/i, /\bdated\b|\bfrom\b/i], exDate);
    r.maturityDate = findField(lines, [/maturity\s*date|date\s*of\s*maturity|matur(?:es|ing)\s*on/i, /due\s*date/i], exDate);
    r.maturityAmount = findField(lines, [/maturity\s*(?:amount|amt|value|proceeds)/i, /amount\s*(?:on|at|payable\s*(?:on|at))\s*maturity/i], exAmt);
    const ten = findField(lines, [/tenure|deposit\s*period|period\s*of\s*deposit|\bterm\b|duration|\bperiod\b/i], exTenure);
    r.holder = findField(lines, [/(?:customer|depositor|account\s*holder|applicant|first\s*holder|primary\s*holder|investor)(?:'s)?\s*name/i, /name\s*of\s*(?:the\s*)?(?:depositor|customer|account\s*holder|applicant)/i, /^(?:mr|mrs|ms|shri|smt)\.?\s/i, /^name\b/i], (s) => exText(String(s || '').replace(/^[\s:.\-–|]+/, '').replace(/^(?:mr|mrs|ms|miss|shri|smt|dr)\.?\s+/i, '')));
    r.nominee = findField(lines, [/nominee(?:\s*name)?/i], exText);
    if (/simple interest/.test(low)) r.compounding = 'simple';
    else { const c = low.match(/compound(?:ed|ing)?\s*(?:frequency\s*)?[:\-]?\s*(monthly|quarterly|half[\s-]?yearly|annually|yearly)/) || low.match(/(monthly|quarterly|half[\s-]?yearly|annually|yearly)\s*compound/); if (c) r.compounding = { annually: 'yearly' }[c[1]] || c[1].replace(/\s/, '-'); }
    const po = low.match(/(monthly|quarterly|half[\s-]?yearly|annual|yearly)\s*(?:interest\s*)?pay\s?out|interest\s*pay\s?out\s*(?:frequency|option|mode)?\s*[:\-]?\s*(monthly|quarterly|half[\s-]?yearly|annual|yearly)/);
    if (po) r.payout = ({ annual: 'yearly' }[po[1] || po[2]] || (po[1] || po[2])).replace(/\s/, '-');
    else if (/non[\s-]?cumulative/.test(low) && !/\bcumulative\b(?![\s-]*non)/.test(low.replace(/non[\s-]?cumulative/g, ''))) r.payout = 'quarterly';
    else r.payout = 'cumulative';
    if (/auto[\s-]?renew(?:al)?\s*[:\-]?\s*(?:yes|enabled|opted)/.test(low)) r.autoRenew = 'yes';
    // Dates & tenure
    if (r.startDate && r.maturityDate && r.maturityDate > r.startDate) Object.assign(r, (({ months, days }) => ({ tenureMonths: months, tenureDays: days }))(tenureBetween(r.startDate, r.maturityDate)));
    else if (ten) { r.tenureMonths = ten.months; r.tenureDays = ten.days; if (!r.startDate && r.maturityDate) { const s = addTenure(parseDate(r.maturityDate), -ten.months, 0); s.setDate(s.getDate() - ten.days); r.startDate = iso(s); } }
    // Fallbacks when OCR garbled a label
    const allDates = [...new Set(datesIn(text))].sort();
    if (!r.startDate && allDates.length >= 2) r.startDate = allDates[0];
    if (!r.maturityDate && r.startDate) { const later = allDates.filter((x) => x > r.startDate); if (later.length) r.maturityDate = later[later.length - 1]; }
    if (r.startDate && r.maturityDate && r.maturityDate > r.startDate && !(r.tenureMonths || r.tenureDays)) Object.assign(r, (({ months, days }) => ({ tenureMonths: months, tenureDays: days }))(tenureBetween(r.startDate, r.maturityDate)));
    if (!r.principal) { const amts = lines.filter((l) => !/maturity|interest/i.test(l)).map(exAmt).filter((v) => v && v >= 1000); if (amts.length) r.principal = amts[0]; }
    if (!r.maturityAmount) { const ml = lines.find((l) => /matur/i.test(l) && exAmt(l)); if (ml) r.maturityAmount = exAmt(ml); }
    if (r.maturityAmount && r.principal && r.maturityAmount < r.principal) { const t = r.maturityAmount; r.maturityAmount = r.principal; r.principal = t; }
    if (r.maturityAmount && r.principal && r.maturityAmount === r.principal && r.payout === 'cumulative') r.maturityAmount = null;
    if (r.rate) r.rate = num(r.rate);
    return r;
  }

  function parsePolicyText(text) {
    const lines = toLines(text), low = text.toLowerCase(), r = {};
    r.insurer = pickFirst(text, INSURERS_RE);
    const has = (re) => re.test(low);
    r.type = has(/motor|private car|two[\s-]?wheeler|vehicle|registration no|\bidv\b|chassis|engine no/) ? 'vehicle'
      : has(/health|mediclaim|hospitali[sz]ation|floater|optima|star health|care health|niva bupa|cashless/) ? 'health'
        : has(/\bterm\b|protect|iprotect|smart shield|saral jeevan bima|pure risk|death benefit only/) && !has(/maturity benefit|bonus|endowment|ulip|fund value/) ? 'term'
          : has(/endowment|jeevan|ulip|unit linked|money back|bonus|fund value|maturity benefit|guaranteed|savings plan/) ? 'life'
            : has(/home|householder|dwelling|burglary/) ? 'home' : has(/travel|trip|overseas/) ? 'travel' : has(/personal accident/) ? 'accident' : has(/life/) ? 'term' : 'other';
    r.policyNumber = findField(lines, [/policy\s*(?:no\.?|number|#|num)/i, /certificate\s*(?:no\.?|number)/i, /contract\s*(?:no\.?|number)/i], exToken);
    r.planName = findField(lines, [/(?:plan|product)\s*name/i, /name\s*of\s*(?:the\s*)?(?:plan|product)/i, /^(?:plan|product)\b/i], exText);
    r.sumAssured = findField(lines, [/(?:basic\s*)?sum\s*assured/i, /(?:basic\s*)?sum\s*insured/i, /total\s*idv|insured'?s?\s*declared\s*value|\bidv\b/i, /cover(?:age)?\s*amount|life\s*cover|death\s*benefit/i], exAmt);
    r.premium = findField(lines, [/total\s*premium|premium\s*\(?(?:incl|including)|gross\s*premium|total\s*amount\s*(?:paid|payable)/i, /(?:installment|instalment|modal|annuali[sz]ed|annual|renewal)\s*premium/i, /premium\s*(?:amount|payable|paid)/i, /\bpremium\b/i], exAmt, { skip: /sum\s*(?:assured|insured)|waiver|return of premium/i });
    const fq = low.match(/(?:mode|frequency)\s*(?:of\s*)?(?:premium|payment)?(?:\s*payment)?\s*[:\-]?\s*(yearly|annual(?:ly)?|half[\s-]?yearly|quarterly|monthly|single)/) || low.match(/(yearly|annual|half[\s-]?yearly|quarterly|monthly)\s*(?:premium|mode)/);
    r.frequency = /single\s*premium/.test(low) ? 'single' : fq ? ({ annual: 'yearly', annually: 'yearly' }[fq[1]] || fq[1].replace(/\s/, '-')) : 'yearly';
    const periodLine = lines.find((l) => /period\s*of\s*insurance|policy\s*period|insurance\s*period|period\s*of\s*cover|cover\s*period/i.test(l) && datesIn(l).length >= 1);
    const periodDates = periodLine ? datesIn(periodLine + ' ' + (datesIn(periodLine).length < 2 ? lines[lines.indexOf(periodLine) + 1] || '' : '')) : [];
    r.startDate = periodDates[0] || findField(lines, [/(?:risk\s*)?commencement\s*date|date\s*of\s*(?:risk\s*)?commencement|commencement/i, /(?:policy\s*)?(?:start|inception|effective|issue)\s*date|valid\s*from|from\s*date|date\s*of\s*issue/i], exDate);
    r.endDate = periodDates[1] || findField(lines, [/(?:policy\s*)?(?:end|expiry|expiration)\s*date|date\s*of\s*(?:expiry|maturity)|valid\s*(?:till|upto|up\s*to)|to\s*date|policy\s*expiry|maturity\s*date/i], exDate);
    if (!r.endDate && r.startDate) {
      const tm = low.match(/policy\s*term\s*[:\-]?\s*(\d{1,2})\s*(?:years|yrs)/);
      if (tm) r.endDate = iso(addTenure(parseDate(r.startDate), +tm[1] * 12, 0));
    }
    r.nextDue0 = findField(lines, [/next\s*(?:premium\s*)?due\s*date|due\s*date\s*of\s*next|next\s*due|renewal\s*(?:due\s*)?date|premium\s*due\s*date|due\s*date/i], exDate);
    r.nextDue = r.nextDue0; delete r.nextDue0;
    if (!r.startDate && r.nextDue) { // OCR slip in the start date (e.g. 05/32/2022): day & month of a yearly policy match the renewal date
      const cl = lines.find((l) => /commencement|start\s*date|inception|issue\s*date/i.test(l));
      const raw = cl && cl.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
      const nd = parseDate(r.nextDue);
      if (raw && +raw[1] === nd.getDate() && +raw[3] >= 1990 && +raw[3] <= nd.getFullYear()) r.startDate = iso(new Date(+raw[3], nd.getMonth(), nd.getDate()));
      if (r.startDate && !r.endDate) { const tm = low.match(/policy\s*term\s*[:\-]?\s*(\d{1,2})\s*(?:years|yrs)/); if (tm) r.endDate = iso(addTenure(parseDate(r.startDate), +tm[1] * 12, 0)); }
    }
    if (!r.nextDue && r.frequency !== 'single') {
      if (['health', 'vehicle', 'home', 'travel', 'accident'].includes(r.type) && r.endDate) { const d = parseDate(r.endDate); d.setDate(d.getDate() + 1); r.nextDue = iso(d); }
      else if (r.startDate) {
        const step = freqMonths(r.frequency) || 12; let d = parseDate(r.startDate), k = 0;
        while (d <= today0() && k < 1200) { k++; d = addTenure(parseDate(r.startDate), step * k, 0); }
        r.nextDue = iso(d);
      }
    }
    r.insured = findField(lines, [/name\s*of\s*(?:the\s*)?(?:insured|life\s*assured)/i, /life\s*assured(?:\s*name)?/i, /insured\s*(?:person|name|member)s?(?:\s*name)?/i, /(?:proposer|policy\s*holder|policyholder)(?:'s)?\s*(?:name)?/i], (s) => exText(String(s || '').replace(/^[\s:.\-–|]+/, '').replace(/^(?:mr|mrs|ms|miss|shri|smt|dr)\.?\s+/i, '')));
    r.nominee = findField(lines, [/nominee(?:\s*name)?/i], exText);
    const veh = text.match(/\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{4})\b/);
    if (veh && r.type === 'vehicle') r.vehicleNumber = veh.slice(1).join('');
    const help = text.match(/\b(1800[\s-]?\d{2,4}[\s-]?\d{3,4})\b/);
    if (help) r.helpline = help[1];
    r.agentName = findField(lines, [/(?:agent|advisor|adviser|intermediary|broker)(?:'s)?\s*name/i], exText);
    const ap = text.match(/(?:agent|advisor|adviser|intermediary)[^\n]{0,60}?(?:mobile|phone|contact|tel)[^\d\n]{0,12}((?:\+91[\s-]?)?[6-9]\d{9})/i);
    if (ap) r.agentPhone = ap[1];
    return r;
  }

  // ---------- Combine several OCR reads ----------
  const present = (v) => v !== null && v !== undefined && v !== '';
  function mergeReads(rs, checks) {
    const out = {};
    const keys = [...new Set(rs.flatMap((r) => Object.keys(r)))];
    keys.forEach((k) => {
      const vals = rs.map((r) => r[k]).filter(present);
      if (!vals.length) return;
      const ok = checks[k] ? vals.filter((v) => checks[k](v)) : vals;
      // Prefer a value that several reads agree on, then the first plausible one
      const count = (v) => vals.filter((x) => String(x) === String(v)).length;
      const pool = ok.length ? ok : vals;
      out[k] = pool.slice().sort((a, b) => count(b) - count(a))[0];
    });
    return out;
  }
  function parseFdReads(texts) {
    const rs = texts.map(parseFdText);
    if (rs.length === 1) return rs[0];
    const m = mergeReads(rs, { rate: (v) => v >= 2 && v <= 12, principal: (v) => v >= 500 });
    // principal / maturity: choose the pair that makes sense together
    const P = rs.map((r) => r.principal).filter(present), M = rs.map((r) => r.maturityAmount).filter(present);
    let best = null;
    P.forEach((p) => M.forEach((x) => { if (x > p && x < p * 2.5) { const sc = 1; if (!best || sc > best.sc) best = { p, x, sc }; } }));
    if (best) { m.principal = best.p; m.maturityAmount = best.x; }
    else if (m.maturityAmount && m.principal && !(m.maturityAmount > m.principal && m.maturityAmount < m.principal * 2.5)) {
      const fixed = M.map((x) => x / 100).find((x) => x > m.principal && x < m.principal * 2.5); // decimal point lost
      m.maturityAmount = fixed || null;
    }
    if (m.startDate && m.maturityDate && m.maturityDate > m.startDate) Object.assign(m, (({ months, days }) => ({ tenureMonths: months, tenureDays: days }))(tenureBetween(m.startDate, m.maturityDate)));
    return m;
  }
  function parsePolicyReads(texts) {
    const rs = texts.map(parsePolicyText);
    if (rs.length === 1) return rs[0];
    const m = mergeReads(rs, { sumAssured: (v) => v >= 10000, policyNumber: (v) => String(v).replace(/\D/g, '').length >= 5 });
    const S2 = rs.map((r) => r.sumAssured).filter(present), Pr = rs.map((r) => r.premium).filter(present);
    if (m.premium && m.sumAssured && !(m.premium < m.sumAssured / 3)) { const p = Pr.find((x) => x < m.sumAssured / 3); m.premium = p || null; }
    if (m.startDate && m.endDate && m.endDate <= m.startDate) { const e = rs.map((r) => r.endDate).filter((x) => x && x > m.startDate)[0]; m.endDate = e || null; }
    if (m.startDate && ['health', 'vehicle', 'home', 'travel', 'accident'].includes(m.type)) { // one-year policies
      const exp = addTenure(parseDate(m.startDate), 12, 0); exp.setDate(exp.getDate() - 1);
      const e = iso(exp), nx = iso(addTenure(parseDate(m.startDate), 12, 0));
      if (rs.some((r) => r.endDate === e)) m.endDate = e;
      if (m.endDate === e && rs.some((r) => r.nextDue === nx)) m.nextDue = nx;
    }
    void S2;
    return m;
  }

  // ---------- Scan flow ----------
  function progressModal(title) {
    const m = modal(title);
    m.body.innerHTML = `<div class="scan-prog"><div class="em">🔍</div><div class="msg">Starting…</div><div class="bar" style="margin-top:12px"><i style="width:3%"></i></div>
      <p class="small muted" style="margin-top:14px">Reading happens on this device. The first photo scan downloads the text-recognition engine (~6 MB) once.</p></div>`;
    return {
      set(msg, p) { const mm = $('.msg', m.body), b = $('.bar i', m.body); if (mm && msg) mm.textContent = msg; if (b && p !== undefined) b.style.width = Math.max(3, Math.min(100, p * 100)) + '%'; },
      close: m.close,
    };
  }
  const FD_LABELS = { bank: 'bank', fdNumber: 'FD number', principal: 'amount', rate: 'rate', startDate: 'start date', maturityDate: 'maturity date', maturityAmount: 'maturity amount', nominee: 'nominee' };
  const POL_LABELS = { insurer: 'insurer', policyNumber: 'policy number', sumAssured: 'cover', premium: 'premium', startDate: 'start date', endDate: 'end date', nextDue: 'next due', insured: 'insured', nominee: 'nominee' };
  function scanBanner(found, labels, docName) {
    const got = Object.keys(labels).filter((k) => found[k]);
    const miss = Object.keys(labels).filter((k) => !found[k]);
    return `<span class="small">✨ <b>Filled ${got.length} field${got.length === 1 ? '' : 's'} from ${docName ? '“' + esc(docName) + '”' : 'the document'}.</b> Please check everything before saving${miss.length ? `; not found: ${miss.map((k) => labels[k]).join(', ')}` : ''}.</span>`;
  }
  async function scanDocument(file, { hint = '', docId = '', docName = '', quiet = false } = {}) {
    const pm = progressModal('Reading document');
    ocrProgress = (m) => {
      const map = { 'loading tesseract core': 'Loading text recognition…', 'initializing tesseract': 'Starting text recognition…', 'loading language traineddata': 'Loading English language data…', 'initializing api': 'Starting…', 'recognizing text': 'Recognising text…' };
      pm.set(map[m.status] || null, m.status === 'recognizing text' ? 0.3 + 0.7 * (m.progress || 0) : 0.1 + 0.2 * (m.progress || 0));
    };
    let text, texts;
    try { texts = await extractTexts(file, (msg, p) => pm.set(msg, p)); text = texts.join('\n'); }
    catch (e) { pm.close(); ocrProgress = null; alert('Could not read this document: ' + (e.message || e) + '\n\nYou can still fill in the details by hand.'); return null; }
    ocrProgress = null;
    pm.set('Finding details…', 1);
    const det = detectKind(text);
    const kind = hint || det.kind;
    pm.close();
    if (docId) { const d = S.documents.find((x) => x.id === docId); if (d && !d.text) { d.text = texts[0].replace(/\s+/g, ' ').trim().slice(0, 2000); save(); } }
    if (!kind) {
      if (!text.trim()) { alert('No readable text was found. Try a clearer, well-lit photo or the PDF from your bank / insurer email.'); return null; }
      if (quiet) { toast('Document saved — text is now searchable'); return null; }
      return chooseKind(file, { docId, docName, texts });
    }
    openScanned(kind, texts, file, { docId, docName });
    return kind;
  }
  function chooseKind(file, ctx) {
    const m = modal('What is this document?');
    m.body.innerHTML = `<p class="small muted" style="margin-top:0">It didn't clearly look like an FD receipt or an insurance policy.</p>
      <div class="btn-row"><button class="btn" data-k="fd">🔒 FD receipt</button><button class="btn" data-k="policy">🛡️ Insurance policy</button></div>
      <button class="btn block" style="margin-top:10px" data-k="">Neither, just keep it</button>`;
    m.body.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; m.close(); if (b.dataset.k) openScanned(b.dataset.k, ctx.texts, file, ctx); });
  }
  function openScanned(kind, texts, file, { docId, docName }) {
    const attach = docId ? { docId } : { file };
    if (kind === 'fd') {
      const r = parseFdReads(texts);
      const prefill = {};
      ['bank', 'fdNumber', 'holder', 'principal', 'rate', 'startDate', 'tenureMonths', 'tenureDays', 'compounding', 'payout', 'nominee', 'autoRenew'].forEach((k) => { if (r[k] !== null && r[k] !== undefined && r[k] !== '') prefill[k] = r[k]; });
      if (r.maturityAmount) prefill.maturityOverride = r.maturityAmount;
      fdForm(null, { prefill, banner: scanBanner(r, FD_LABELS, docName || (file && file.name)), ...attach });
    } else {
      const r = parsePolicyReads(texts);
      const prefill = {};
      ['type', 'insurer', 'planName', 'policyNumber', 'insured', 'vehicleNumber', 'sumAssured', 'premium', 'frequency', 'nextDue', 'startDate', 'endDate', 'nominee', 'helpline', 'agentName', 'agentPhone'].forEach((k) => { if (r[k] !== null && r[k] !== undefined && r[k] !== '') prefill[k] = r[k]; });
      policyForm(null, { prefill, banner: scanBanner(r, POL_LABELS, docName || (file && file.name)), ...attach });
    }
  }
  // Attach the scanned file to Docs (when it came from the FD / policy form) and link it
  function linkScannedFile(opts, rec, kind) {
    if (opts.docId) return opts.docId;
    if (!opts.file) return '';
    const name = kind === 'fd' ? `FD receipt — ${rec.bank || ''}${rec.fdNumber ? ' ' + rec.fdNumber : ''}`.trim() : `Policy — ${rec.insurer || ''}${rec.planName ? ' ' + rec.planName : ''}`.trim();
    addDocuments([opts.file], { name, category: kind === 'fd' ? 'Bank' : 'Insurance', expiry: kind === 'fd' ? '' : (rec.endDate || ''), compress: true, quiet: true }).then((ids) => {
      if (!ids[0]) return;
      const list = kind === 'fd' ? S.fds : S.policies;
      const it = list.find((x) => x.id === rec.id);
      if (it) { if (kind === 'fd') it.docId = ids[0]; else it.linkedDocId = ids[0]; save(); render(); }
    }).catch(() => {});
    return '';
  }
  function pickFileThen(cb, accept = 'image/*,application/pdf') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) cb(f); });
    document.body.appendChild(inp); inp.click();
  }

  // ---------- Events ----------
  const actions = {
    back,
    privacy: () => { document.body.classList.toggle('privacy'); try { localStorage.setItem('acctmgr.privacy', document.body.classList.contains('privacy') ? '1' : ''); } catch {} },
    month: (d) => { st.month = shiftMonth(st.month, +d.by); render(); },
    fab: () => {
      if (st.sub && st.sub.kind === 'ppf') return actions['add-ppf-dep']({ id: st.sub.id });
      if (!st.sub && st.tab === 'docs') return docForm(null);
      if (st.sub && st.sub.kind === 'vehicle') return actions['veh-log']({ id: st.sub.id, kind: 'fuel' });
      return actions['add-txn']({});
    },
    'invest-tab': (d) => { st.investTab = d.v; render(); },
    'add-bill': () => billForm(null),
    'edit-bill': (d) => { const b = S.bills.find((x) => x.id === d.id); if (b) billForm(b); },
    'pay-bill': (d) => { const b = S.bills.find((x) => x.id === d.id); if (b) payBillForm(b); },
    'add-warranty': () => warrantyForm(null),
    'edit-warranty': (d) => { const w = S.warranties.find((x) => x.id === d.id); if (w) warrantyForm(w); },
    'add-vehicle': () => vehicleForm(null),
    'open-vehicle': (d) => { if (S.vehicles.some((v) => v.id === d.id)) openSub({ kind: 'vehicle', id: d.id }); },
    'edit-vehicle': (d) => vehicleForm(S.vehicles.find((v) => v.id === d.id)),
    'veh-log': (d) => { const v = S.vehicles.find((x) => x.id === d.id); if (!v) return; const l = d.log && (v.logs || []).find((x) => x.id === d.log); vehicleLogForm(v, l ? l.kind : d.kind, l || null); },
    'pay-card': (d) => {
      const a = S.accounts.find((x) => x.id === d.id); const c = a && cardCycle(a); if (!a) return;
      const from = S.accounts.find((x) => x.type === 'bank' && !x.archived);
      txnForm(null, { type: 'transfer', accountId: from ? from.id : undefined, toAccountId: a.id, amount: c ? Math.round(c.remaining * 100) / 100 : '', note: `${a.name} bill payment`, noRepeat: true });
    },
    search: () => { openSub({ kind: 'search' }); const i = $('#gsearch'); if (i) { i.focus(); i.select(); } },
    'goto-goals': () => { st.investTab = 'goals'; go('invest'); },
    'add-policy': () => policyForm(null),
    'open-policy': (d) => { if (S.policies.some((p) => p.id === d.id)) openSub({ kind: 'policy', id: d.id }); },
    'edit-policy': (d) => policyForm(S.policies.find((p) => p.id === d.id)),
    'pay-premium': (d) => premiumForm(S.policies.find((p) => p.id === d.id)),
    'add-goal': () => goalForm(null),
    'open-goal': (d) => openSub({ kind: 'goal', id: d.id }),
    'edit-goal': (d) => goalForm(S.goals.find((g) => g.id === d.id)),
    'goal-money': (d) => goalMoneyForm(S.goals.find((g) => g.id === d.id), d.type),
    'goal-del': (d) => { const g = S.goals.find((x) => x.id === d.id); if (g && confirm('Remove this entry?')) { g.contributions = g.contributions.filter((c) => c.id !== d.c); save(); render(); } },
    'em-contact': (d) => contactForm(d.id ? S.emergency.contacts.find((c) => c.id === d.id) : null),
    'em-save': () => { S.emergency = { ...S.emergency, notes: $('#em-notes').value }; save(); toast('Notes saved'); },
    'em-pdf': async (d) => {
      const notes = $('#em-notes'); if (notes && notes.value !== S.emergency.notes) { S.emergency = { ...S.emergency, notes: notes.value }; save(); }
      const opts = { balances: $('#em-bal').checked, full: $('#em-full').checked };
      const win = d.how === 'open' && !native() ? window.open('', '_blank') : null;
      toast('Creating PDF…');
      try {
        const blob = await makeEmergencyPdf(opts);
        const meta = { name: `Family-Financial-Info-${iso()}`, fileName: 'x.pdf', mime: 'application/pdf' };
        if (win) win.location.href = URL.createObjectURL(blob);
        else if (d.how === 'open') openBlob(blob, meta); else shareBlob(blob, meta);
      } catch (e) { if (win) win.close(); alert('Could not create PDF: ' + e.message); }
    },
    'sms-enable': () => enableInbox(),
    'sms-reset': () => { if (confirm('Create a new link? You must update the URL in your Shortcut afterwards.')) enableInbox(); },
    'sms-test': async () => {
      try {
        const body = { fields: { text: { stringValue: encodeURIComponent(`Rs.1.00 debited from A/c XX0000 on ${new Date().toLocaleDateString('en-GB').replace(/\//g, '-')} to VPA test@upi (test message from Account Manager)`) }, src: { stringValue: 'test' } } };
        const r = await fetch(Cloud.inboxUrl(S.settings.inboxToken), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.text()).slice(0, 200));
        toast('Test sent — it will appear in the SMS inbox');
      } catch (e) { alert('Test failed: ' + e.message + '\n\nMake sure the latest firestore.rules are deployed (npx firebase-tools deploy).'); }
    },
    'sms-read': () => {
      const txt = ($('#sms-paste').value || '').trim(); if (!txt) return toast('Paste an SMS first');
      const parts = txt.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
      st.pasted = (st.pasted || []).concat(parts.map((x) => ({ id: 'p_' + uid(), text: x, at: iso(), src: 'paste' })));
      render(); toast(`${parts.length} message${parts.length > 1 ? 's' : ''} read`);
    },
    'sms-add': (d) => { const it = pendingSms().find((x) => x.id === d.id); if (it && it.p) { addFromSms(it); save(); render(); toast('Entry added'); } },
    'sms-addall': () => { const ok = pendingSms().filter((x) => x.p && x.p.accountId && !x.p.duplicate); ok.forEach(addFromSms); save(); render(); toast(`${ok.length} entries added`); },
    'sms-ignore': (d) => { const it = pendingSms().find((x) => x.id === d.id); if (it) { dropSms(it); render(); } },
    'sms-edit': (d) => {
      const it = pendingSms().find((x) => x.id === d.id); if (!it || !it.p) return;
      const p = it.p;
      txnForm(null, { type: p.type, amount: p.amount, accountId: p.accountId || undefined, toAccountId: p.toAccountId, category: p.category, note: p.note, date: p.date, mode: p.mode, noRepeat: true,
        onSaved: (rec) => { rec.fromSms = true; learnCategory(p, rec.category); dropSms(it); save(); render(); } });
    },
    'add-ppf': () => ppfForm(null),
    'open-ppf': (d) => { if (S.ppf.some((p) => p.id === d.id)) openSub({ kind: 'ppf', id: d.id }); },
    'edit-ppf': (d) => ppfForm(S.ppf.find((p) => p.id === d.id)),
    'add-ppf-dep': (d) => { const p = S.ppf.find((x) => x.id === d.id); if (p) ppfDepositForm(p, null); },
    'edit-ppf-dep': (d) => { const p = S.ppf.find((x) => x.id === d.id); const dep = p && (p.deposits || []).find((x) => x.id === d.dep); if (dep) ppfDepositForm(p, dep); },
    'add-doc': () => docForm(null),
    'open-doc': (d) => { const doc = S.documents.find((x) => x.id === d.id); if (doc) openDocument(doc); },
    'doc-cat': (d) => { st.docCat = d.v; render(); },
    'edit-budget': (d) => budgetForm(d.k || null),
    'edit-rec': (d) => { const r = S.recurring.find((x) => x.id === d.id); if (r) recurringForm(r); },
    pin: (d) => pinForm(d.mode),
    'add-txn': (d) => txnForm(null, { accountId: d.account || (st.sub && st.sub.kind === 'account' ? st.sub.id : '') || undefined }),
    'edit-txn': (d) => { const t = S.transactions.find((x) => x.id === d.id); if (t) txnForm(t); },
    'add-account': () => accountForm(null),
    'open-account': (d) => openSub({ kind: 'account', id: d.id }),
    'edit-account': (d) => accountForm(S.accounts.find((x) => x.id === d.id)),
    reveal: (d) => { st.reveal[d.key] = !st.reveal[d.key]; render(); },
    copy: (d) => copy(d.text),
    'add-fd': () => fdForm(null),
    'edit-fd': (d) => fdForm(S.fds.find((x) => x.id === d.id)),
    'fd-tab': (d) => { st.fdTab = d.v; render(); },
    'add-asset': (d) => assetForm(null, d.kind),
    'edit-asset': (d) => assetForm(S.assets.find((x) => x.id === d.id)),
    open: (d) => openSub({ kind: d.kind }),
    'cat-del': (d) => { if (!confirm(`Remove category "${d.name}"? Existing entries keep it.`)) return; S.categories[d.kind] = S.categories[d.kind].filter((c) => c !== d.name); save(); render(); },
    'cat-add': (d) => {
      const el = $('#newcat-' + d.kind); const v = el.value.trim();
      if (!v) return; if (S.categories[d.kind].includes(v)) return toast('Already exists');
      S.categories[d.kind].push(v); save(); render(); toast('Category added');
    },
    'hide-tip': () => { S.settings.hideCloudTip = true; saveLocal(); render(); },
    'cfg-save': () => {
      try { Cloud.saveConfig($('#cfg-text').value); toast('Saved — reloading…'); setTimeout(() => location.reload(), 600); }
      catch (e) { alert(e.message); }
    },
    'cfg-clear': () => { if (confirm('Remove the Firebase project from this device?')) { Cloud.clearConfig(); location.reload(); } },
    'cl-signin': () => cloudAuth('signIn'),
    'cl-signup': () => cloudAuth('signUp'),
    'cl-reset': async () => {
      const email = $('#cl-email').value; if (!email) return toast('Enter your email first');
      try { await Cloud.resetPassword(email); alert('Password reset email sent to ' + email); } catch (e) { alert(e.message); }
    },
    'cl-signout': async () => {
      if (!confirm('Sign out? Data will be removed from this device but stays in your cloud account.')) return;
      try { await Cloud.signOut(); await FileStore.clear().catch(() => {}); inboxItems = []; st.pasted = []; st.sub = null; st.tab = 'home'; render(); toast('Signed out'); } catch (e) { alert(e.message); }
    },
    'export-json': exportJson,
    'export-csv': exportCsv,
    'import-json': () => $('#importFile').click(),
    'save-settings': () => {
      S.settings.name = $('#set-name').value.trim(); S.settings.currency = $('#set-cur').value;
      Object.keys(fmtCache).forEach((k) => delete fmtCache[k]); save(); toast('Settings saved');
    },
    demo: () => { if (confirm('Add sample data to the app?')) loadDemo(); },
    reset: () => {
      if (!confirm(signedIn() ? 'Erase ALL data from your CLOUD ACCOUNT and every synced device? This cannot be undone.' : 'Erase ALL data from this device? This cannot be undone.')) return;
      if (!confirm('Really erase everything? Make sure you exported a backup.')) return;
      S.documents.forEach(removeDocFiles); FileStore.clear().catch(() => {});
      S = defaultData(); save(); st.sub = null; st.tab = 'home'; render(); toast('All data erased');
    },
  };

  async function cloudAuth(kind) {
    const email = $('#cl-email').value, pw = $('#cl-pass').value;
    if (!email || !pw) return toast('Enter email and password');
    const btns = document.querySelectorAll('[data-act^="cl-"]'); btns.forEach((b) => { b.disabled = true; });
    try { await Cloud[kind](email, pw); toast(kind === 'signUp' ? 'Account created — syncing…' : 'Signed in — syncing…'); }
    catch (e) { alert(e.message); }
    finally { btns.forEach((b) => { b.disabled = false; }); }
  }

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) return go(tab.dataset.tab);
    const tg = e.target.closest('[data-tab-go]');
    if (tg) return go(tg.dataset.tabGo);
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](el.dataset); }
  });
  const LIVE = ['q', 'docq', 'gq'];
  $('#view').addEventListener('change', (e) => {
    const k = e.target.dataset.filter;
    if (k && !LIVE.includes(k)) { st.filter[k] = e.target.value; render(); }
  });
  $('#view').addEventListener('input', (e) => {
    const k = e.target.dataset.filter;
    if (LIVE.includes(k)) {
      st.filter[k] = e.target.value;
      const pos = e.target.selectionStart; render();
      const inp = $(`[data-filter="${k}"]`); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modalRoot').lastElementChild) $('#modalRoot').lastElementChild.remove();
  });

  // Android hardware back button (APK)
  const App = plugin('App');
  if (App) {
    App.addListener('backButton', () => {
      if ($('#lock')) { App.exitApp(); return; }
      const top = $('#modalRoot').lastElementChild;
      if (top) top.remove();
      else if (st.sub) back();
      else if (st.tab !== 'home') go('home');
      else App.exitApp();
    });
  }

  // Auto-lock & recurring check when returning to the app
  document.addEventListener('visibilitychange', () => { if (document.hidden) onAppHidden(); else onAppVisible(); });
  if (App) App.addListener('appStateChange', ({ isActive }) => { if (isActive) onAppVisible(); else onAppHidden(); });

  // Sync between tabs (website)
  window.addEventListener('storage', (e) => { if (e.key === KEY && !signedIn()) { S = load(); render(); } });

  try { if (localStorage.getItem('acctmgr.privacy')) document.body.classList.add('privacy'); } catch {}
  if (window.Cloud) {
    Cloud.init({
      getState: () => S,
      setState: (d) => { S = d ? migrate(d) : defaultData(); Object.keys(fmtCache).forEach((k) => delete fmtCache[k]); saveLocal(); scheduleRender(); },
      render: scheduleRender,
      statusChanged: updateSyncBadge,
      toast,
      onReady: () => { runRecurring(); uploadPendingFiles(); startInboxWatch(); },
    });
  }
  if (/[?&]amtest\b/.test(location.search)) window.__am = { parseSms, parseFdText, parsePolicyText, parseFdReads, parsePolicyReads, detectKind, extractText, extractTexts, getState: () => S };
  showLock();
  runRecurring();
  render();

  // Offline support for the website
  if ('serviceWorker' in navigator && !native() && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
