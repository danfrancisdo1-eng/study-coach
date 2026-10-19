# Pricing (SPEC §9, D-144, D-153): Dan's setup steps

The app and server are ready for these products. Nothing charges anyone until `PREMIUM_LIMITS=on` on Render (the last step).

## A. App Store Connect → RapidRecall AI → Monetization
1. **Subscriptions** → the existing group (or create "RapidRecall AI Premium"):
   - Monthly: set the price to **$12.99**.
   - Yearly: set the price to **$79.99**.
   (If the products were made at the old $4.99 / $29.99 prices, change their price here; the Product IDs stay.)
2. On **each** of the two subscriptions: **Subscription Prices → Introductory Offers → +** → type **Free**, duration **1 week**, all countries. This is the student free week; Apple gives it once per Apple ID.
3. **In-App Purchases → +** → type **Non-Renewing Subscription**:
   - Reference name "Exam Pass (60 days)", Product ID **rapidrecall.exampass.60d**, price **$29.99**.
   - Display name "Exam Pass", description "60 days of everything for your certification exam."
4. Each product needs a review screenshot before submission (a screenshot of the paywall is fine; I can make it).

## B. RevenueCat (app.revenuecat.com) → the RapidRecall project
1. **Product catalog → Products → +**: add **rapidrecall.exampass.60d** (App Store).
2. **Entitlements → +** a new entitlement **exam_pass** with the exam pass attached. Do **not** attach the pass to **premium**: a pass unlocks one exam, not the account (D-156).
3. **Offerings → +** new offering, identifier **exam** (exactly), one package (type **Custom** or **Lifetime**) with **rapidrecall.exampass.60d**. Leave the student offering (monthly + annual) as the **current** one.
4. Nothing to change for the webhook: the server records each pass for the exam it was bought from, for 60 days.

## C. Render (study-coach-api → Environment)
- Optional: `EXAM_PASS_PRODUCT_ID` = **rapidrecall.exampass.60d** (the server also recognizes any product id with "exampass" in it).
- **At launch only:** `PREMIUM_LIMITS` = **on**. Until then everyone has full access (the beta keeps working).

## D. Test on TestFlight with a Sandbox account
Settings → App Store → Sandbox Account on the iPhone. Then in the app: a student course → Account → Premium → "Start your free week"; a certification exam → after 50 questions the exam pass paywall → "Get the exam pass". No real charge in Sandbox.
