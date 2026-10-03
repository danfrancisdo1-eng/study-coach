---
name: mobile-store-preflight
description: Review a native iOS or Android app before Apple App Store or Google Play submission. Use for store release readiness, rejections, account/program requirements, privacy declarations, and regulatory deadlines.
---

# Mobile store preflight

Use this independently written instruction before a **native** iOS or Android release, including when asked to run a submission command. Study Coach is currently a web/PWA prototype; a web scan is not evidence that a native build is ready to submit. This instruction is not a shell hook and cannot intercept submissions on its own.

1. Identify the app root, native platforms, app type, launch countries, intended age groups, account type, monetization, and release route. If any are unknown, ask rather than assume. If there is no native target, say the native review cannot be completed.
2. Check the **current** [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [App Store Connect Help](https://developer.apple.com/help/app-store-connect/), [Google Play policies](https://play.google.com/about/developer-content-policy/), and [Play Console Help](https://support.google.com/googleplay/android-developer/) for applicable rules. Check regional legal claims against the relevant regulator. A working URL alone does not verify the claim it is cited for.
3. Inspect the actual release build and listing materials: launch and sign-in paths, reviewer access, privacy policy and declarations, SDK data collection, permissions, user-generated content safeguards where applicable, age ratings, purchases, account deletion, screenshots, descriptions, and platform build requirements. Mark what was observed, what is missing, and what cannot be determined from code.
4. Ask the owner to confirm items code cannot establish: active developer accounts; accepted current agreements and attachments; any required tax or banking setup; developer-identity and package-name registration; required testing tracks; review credentials; and storefront availability. Never infer these are complete from a clean code scan.
5. Report findings in severity order with platform, evidence, official source, concrete fix, and confidence. Separate confirmed blockers from items needing human verification and from non-applicable checks. Never claim a release is clear while a confirmed critical risk remains. Do not submit an app or act on a GitHub account without an explicit request.

This is a review process, not a claim that static checks can certify legal or store-policy compliance. For an automatic command-blocking gate, configure a separate hook or CI step in the environment that actually performs submissions.