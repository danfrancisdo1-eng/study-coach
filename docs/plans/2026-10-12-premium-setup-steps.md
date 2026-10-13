# Premium: Dan's setup steps (App Store Connect, RevenueCat, Render, Expo)

Order matters: A → B → C → D → E. Values to copy are in **bold**. Nothing here touches Personal Max: Study Coach has its own bundle ID (**com.danfrancis.studycoach**), app record and certificates.

## A. App Store Connect (appstoreconnect.apple.com)
1. **Business → Agreements**: accept the **Paid Apps** agreement and fill in bank and tax. Purchases cannot work until it says Active.
2. **Apps → + → New App**: iOS; name "Study Coach" (if taken, "Study Coach – AI Tutor"); bundle ID **com.danfrancis.studycoach** (if it is not in the list, step E registers it; come back after); SKU **studycoach**.
3. In the app: **Monetization → Subscriptions → Create subscription group**: "Study Coach Premium".
4. In the group, add two subscriptions:
   - Reference "Premium Monthly", Product ID **studycoach.premium.monthly**, 1 month, **$4.99**.
   - Reference "Premium Yearly", Product ID **studycoach.premium.yearly**, 1 year, **$29.99**.
   Each needs a display name and a one-line description (e.g. "Unlimited courses and more daily study"); the review screenshot can wait until submission.
5. **Users and Access → Integrations → In-App Purchase → Generate key**: download the **.p8** file once; note the **Key ID** and **Issuer ID**.
6. **Users and Access → Sandbox → Testers → +**: a test Apple account with an email you do not use elsewhere. You buy with it on the phone; no real charge.

## B. RevenueCat (app.revenuecat.com)
1. Sign up; create project "Study Coach"; **+ App → App Store**, bundle ID **com.danfrancis.studycoach**; upload the .p8 with its Key ID and Issuer ID.
2. **Product catalog → Products**: add **studycoach.premium.monthly** and **studycoach.premium.yearly**.
3. **Entitlements → +**: identifier **premium** (exactly); attach both products.
4. **Offerings**: the "default" offering, marked current, with two packages: **Monthly** and **Annual**, one product each.
5. **API keys**: copy the **public iOS SDK key** (starts `appl_`) and a **secret key** (starts `sk_`).
6. **Integrations → Webhooks → +**: URL **https://study-coach-api-pskt.onrender.com/api/premium/revenuecat**; Authorization header: a long random phrase you make up (e.g. 40 letters and digits). Keep it for C.

## C. Render (the study-coach-api service → Environment)
Add:
- `REVENUECAT_SECRET_KEY` = the `sk_` key from B5
- `REVENUECAT_WEBHOOK_AUTH` = exactly the Authorization value from B6
- `OWNER_ACCOUNT_IDS` = your Clerk user id (Clerk dashboard → Users → you → User ID, starts `user_`)
Leave `PREMIUM_LIMITS` **unset** for now. It goes `on` only when purchases work on TestFlight.

## D. Expo build environment (the build service does not see `.env.local`)
Claude Code can run these on the Mac with your Expo login once B5 is done (the Clerk key and server address are already in `.env.local`):
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (the `appl_` key; it is public and meant to ship in the app).

## E. The first development build (about 20 minutes, mostly waiting)
In Terminal, in `artifacts/study-coach-mobile`:
1. `npx eas-cli init`: links Study Coach to your Expo account (adds a project id to app.json).
2. `npx eas-cli device:create`: open the link on the iPhone and install the profile, so the build can run on it.
3. `npx eas-cli build --profile development --platform ios`: sign in with your Apple ID when asked; let EAS create the certificate and register the bundle ID.
4. Open the build link on the iPhone and install. From then on: `npx expo start` (no `--go`) and the new Study Coach app opens it instead of Expo Go.

Until E is done, start the preview with **`npx expo start --go`** so Expo Go still works.
