# Premium and the free tier — spec v1 (draft for Dan's sign-off)

Decisions: D-003 (one free course, premium for more) and D-090 (model, price, lapse, caps).

## Who
Any signed-in student, 13 and up, on the iPhone app. The web app honours the same limits but sells nothing in v1.

## v1 does
1. **Free:** one course or certification exam, every feature. The server refuses a second course for a free account with a plain message and the app opens the paywall.
2. **Premium, "Study Coach Premium":** one auto-renewing subscription group, two products: **$4.99 a month** and **$29.99 a year**. Unlimited courses.
3. **Daily AI limits, server-enforced** (the existing lecture-quota pattern), reset every 24 hours:
   - free: 3 question sets or flashcard decks, 40 coach messages;
   - premium: 20 sets or decks, 300 coach messages.
   Lecture transcription keeps its own existing quota. Hitting a limit gives one plain sentence ("You've used today's 3 sets. More tomorrow, or go Premium.") and never loses the draft, answers or conversation.
4. **Lapse:** when premium ends, the **first course the student added** stays fully active; every other course becomes **read-only**: materials, results, past sets and chats stay visible; new AI work there is refused with a plain sentence and a button to renew. Nothing is ever deleted. Renewing unlocks everything again.
5. **Paywall sheet** (one screen): what Premium adds, the two prices as Apple shows them (localized), Subscribe, **Restore Purchases**, terms and privacy links, "Cancel any time in Settings." It opens when adding a second course, on a read-only course's AI action, and on a daily limit.
6. **Account page:** "Premium · renews <date>" or "Free plan", Restore Purchases, Manage subscription (opens Apple's subscription settings).
7. **Server is the source of truth:** the entitlement is stored per account and updated from the purchase provider's notifications, re-checked on demand. The app never decides on its own.
8. **Owner accounts:** Dan's account (and any listed in server config) is always premium, so your own courses never go read-only.

## v1 does not
- Android / Google Play, web checkout, or any link to buy outside the App Store.
- Free trials, intro prices, promo codes, family sharing, student discounts.
- Usage dashboards for the student beyond the limit message.
- Refund handling beyond what Apple does (a refunded purchase simply ends the entitlement).

## How (for the plan, needs Dan's OK on each)
- **RevenueCat** (`react-native-purchases`) for purchases, restore and receipt checks; its webhook tells our server. Free until $2,500 a month in revenue. Alternative: Apple's StoreKit directly plus our own App Store Server API code (more work, no third party).
- **An Expo development build:** in-app purchases cannot run in Expo Go, so testing moves to a development build installed on the iPhone (EAS). This adds `expo-dev-client` and an `eas.json`.
- **Database:** one new table for entitlements and one for daily usage counters, through the on-boot migrator (D-039), with a written migration plan first.
- **App Store Connect:** Dan creates the subscription group and the two products, and agrees to Apple's paid-apps agreement; a RevenueCat account with the App Store key.
- **Privacy:** purchase history added to the privacy label and `PRIVACY_DATA.md`.

## Tests first (red before code)
- second course refused for free, allowed for premium and owner accounts;
- daily caps: the 4th set and the 41st message refused for free, allowed for premium up to 20 / 300, reset after 24 h, a failed AI call never counts;
- lapse: AI actions on a non-first course refused, reads allowed, nothing deleted; renewal restores;
- provider notifications: purchase, renewal, expiry, refund update the entitlement; a forged notification is rejected.
