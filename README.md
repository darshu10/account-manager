# Account Manager

A personal finance app that runs as a **website (PWA)** and as an **Android APK**, built from the same code in `www/`.
It works fully offline, and all data stays on the device.

## Features
- **Multiple accounts**: bank (account no., IFSC, branch, UPI, holder), cash, wallets/UPI, credit cards (limit, due day, last 4 digits)
- **Income, expense and transfer** entries, with categories, notes, search, and filters by month, account and type
- **Net worth** = account balances + current value of FDs + other assets − credit card dues − loans
- **Fixed deposits**: maturity date and amount calculated automatically (monthly, quarterly, half-yearly, yearly or simple interest), payout FDs, value today, alerts for FDs maturing soon, closed FDs
- **Assets & liabilities**: gold, property, stocks, MF, PPF, EPF, NPS, loans with EMI
- Home dashboard with month summary, spending by category and a 6-month income vs expense chart
- Privacy mode (eye icon blurs all amounts), masked account numbers with Show/Copy
- Backup/restore as JSON, CSV export for Excel/Sheets, light and dark theme
- **PPF tracker (v1.3)**: deposits and withdrawals, interest worked out the official way (lowest balance between the 5th and month end, credited every 31 March), the ₹1.5 lakh yearly limit, maturity date, extension, estimated maturity value, and loan/withdrawal eligibility
- **Documents (v1.3)**: upload PDFs and photos (or take a photo), then view, download or share them. Large photos are made smaller automatically. Add an expiry date to get a reminder. Files sync through Firestore in about 800 KB chunks, so it stays on the free Spark plan
- **Payment mode (v1.3)**: Cash / UPI / Card / Netbanking on every entry, a filter for it, and a Cash vs Online split on Home
- **Recurring entries, monthly budgets, an Upcoming & reminders card, and a 4-digit PIN lock (v1.3)**
- **v1.6**: reads FD receipts and insurance papers (PDF or photo) on the device and fills in the FD / policy form for you to check. Uses pdf.js for digital PDFs, and Tesseract OCR with lighting correction and two combined reads for photos. Uploaded documents also become searchable by their text
- **v1.5**: bills & subscriptions (Pay button; auto-debit bills record themselves), warranty tracker with bill photos, vehicles (fuel log, automatic mileage, service/PUC/insurance reminders), search across everything, and credit card billing cycles (amount left to pay by the due date, card usage %)
- **v1.4**: insurance policies (cover summary, premium reminders, "premium paid"), savings goals, receipt photos on entries, a Family Emergency Sheet PDF, and **SMS auto-add** (an iPhone Shortcut or Android automation forwards bank SMS to a private inbox; the app reads them and adds each entry with one tap)
- **Cloud sync (v1.1)**: sign in with email and password, and the phone app and the website share the same data. It still works offline: changes are saved on the device and upload automatically when you're back online. The cloud icon at the top shows the status: green = synced, orange = waiting to upload.

## Website
Upload the contents of `www/` (or `dist/AccountManager-website.zip`) to any static host, such as GitHub Pages, Netlify Drop or Cloudflare Pages.
It must be served over HTTPS for offline mode and "Install app" to work.
Run it locally with `npm run serve` and open http://localhost:8080.

> Sign in with the same account on the website and the APK and they share the same data. Without signing in, each device keeps its own local data.

## Cloud setup (one time, about 10 minutes, free)
Data is stored in **your own** Firebase project (Google). The free Spark plan is far more than one person needs.

1. Go to https://console.firebase.google.com → **Add project** (Analytics can be turned off).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database**. Pick a location such as `asia-south1 (Mumbai)` and start in **production mode**.
   Then open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.
   These rules mean each user can read and write only their own data.
4. **Project settings (gear) → Your apps → Web `</>`**. Register the app (no hosting checkbox needed) and copy the `firebaseConfig` block.
5. Connect the app in one of two ways:
   - **Easiest:** in the app go to **More → Cloud Sync**, paste the config, then **Create account**. Do this once on each device (phone and website).
   - **Built in:** put it in `www/firebase-config.js` (`window.FIREBASE_CONFIG = {...}`) and rebuild, so every device is already connected.
     The config is not a secret. Security comes from the login plus the Firestore rules.

## Hosting the website on Firebase
Run this from the project folder on any computer with Node.js:
```
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy
```
Your site goes live at `https://<project-id>.web.app`, with HTTPS included. The deploy also publishes `firestore.rules`.
After changing files in `www/`, bump `VERSION` in `www/sw.js` so installed copies pick up the update.

## Android APK
`dist/AccountManager-v1.0.apk`: copy it to your phone, open it, and allow "Install unknown apps".

Rebuild after changing `www/` (needs the Android SDK at `ANDROID_HOME`):
```
npx cap sync android
cd android && ./gradlew assembleRelease
```
For every update, bump `versionCode` in `android/app/build.gradle`.

### Signing key — keep it safe
`signing/` holds the release keystore and its password. Future updates **must be signed with this same key**.
If you lose it, you'll have to uninstall the app to install a new version, and uninstalling **deletes the app's data**
(export a backup first). Never commit `signing/` to a public repo.
