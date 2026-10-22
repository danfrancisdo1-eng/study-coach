# RapidRecall AI: App Store listing (draft 2026-10-22)

Copy each block into App Store Connect → RapidRecall AI → the 1.0 version page (or App Information / App Privacy where noted). Character limits are Apple's; counts were checked.

---

## App Information page

- **Name** (30): `RapidRecall AI`
- **Subtitle** (30): `Quiz yourself on your notes` (27)
- **Primary category:** Education
- **Secondary category:** Productivity (optional)
- **Content rights:** "Does your app contain, show, or access third-party content?" → **Yes** (it reads web pages the student links). Confirm you have the rights → the student supplies the material for their own studying.
- **Age rating:** see the section below.

## Version page

**Promotional text** (170; can be changed any time without a review):

```
100 questions a day, 10 at a time, from your own notes. Miss one and tomorrow's questions focus on it, until you get 100/100. Start your free week.
```

**Keywords** (100; commas, no spaces, no words already in the name):

```
flashcards,quiz,exam prep,study,spaced repetition,certification,test,notes,tutor,college,lecture
```

(96 characters. No brand names such as MCAT or CompTIA: Apple rejects other companies' trademarks in keywords.)

**Description** (4000):

```
Turn your class notes into practice questions, and keep at it until you know it cold.

RapidRecall AI is a study coach that works from your own material. Add your notes, slides, syllabus or a photo of the whiteboard, and the coach quizzes you on what's actually in your course.

ADD YOUR MATERIAL
• Photos, PDFs, Word and PowerPoint files, or a web page link
• Record a lecture and get a transcript to study from
• The coach turns every upload into clean notes you can review

PRACTICE THAT STICKS
• Multiple-choice sets of 10 to 50 questions, with the reason behind every answer
• Practice mode shows the answer right away; Exam mode saves it for the end
• Memory tricks for the ones you missed
• Flashcards and a memory sheet for each course

DAILY REPS
Study in spare minutes: 100 questions a day, 10 at a time, in line, between classes, on the bus. Whatever you miss today, tomorrow's questions focus on it, until you get 100/100. The day before your exam, the coach makes you a review sheet (PDF) with the spots to focus on highlighted.

CERTIFICATION EXAMS
Studying for a professional certification? Name the exam and the coach looks up its published topics and weights, then quizzes you by section.

ASK ANYTHING
Chat with the coach about any part of your course. Answers come from your own material first; anything from outside your notes is labelled.

PRICING
• Students: a free week with one course, then $12.99 a month or $79.99 a year.
• Certification exams: your first 50 questions are free. Then a $29.99 Exam Pass unlocks that exam for 60 days. It does not renew.
Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your Apple ID settings.

For students 13 and older. Your content is sent to Anthropic (Claude) to coach you, and lecture recordings you choose to transcribe go to OpenAI. The app asks for your consent first.

Privacy policy: https://study-coach-api-pskt.onrender.com/privacy
Terms of Use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

- **Support URL:** `https://study-coach-api-pskt.onrender.com/support`
- **Marketing URL:** leave blank.
- **Privacy Policy URL** (App Privacy page): `https://study-coach-api-pskt.onrender.com/privacy`
- **Copyright:** `2026 Dan Francis`
- **Version:** 1.0.0

## Age rating questionnaire

Answer **None / No** to everything: violence, sexual content, profanity, drugs, alcohol, tobacco, gambling, horror, medical information, contests, unrestricted web access, user-generated content shared with others, messaging between users, advertising.

Then, where Apple offers it, choose a **higher age rating than calculated: 13+**, to match the app's sign-up age check.

## App Privacy (the "nutrition label")

"Do you or your third-party partners collect data from this app?" → **Yes**. Then tick these types. For every one: **linked to the user: Yes**, **used for tracking: No**.

| Data type | Purpose(s) | Why |
|---|---|---|
| Contact Info → Email Address | App Functionality | sign-in (Clerk) |
| Contact Info → Name | App Functionality | sign-in, when shared |
| User Content → Photos or Videos | App Functionality | a picked photo is sent to Claude to read its text (the photo itself isn't stored) |
| User Content → Audio Data | App Functionality | a recording you choose to transcribe goes to OpenAI |
| User Content → Other User Content | App Functionality | notes, files, chat, quiz answers |
| Identifiers → User ID | App Functionality | the account id |
| Purchases → Purchase History | App Functionality | subscriptions and exam passes (RevenueCat) |
| Usage Data → Product Interaction | App Functionality, Analytics | daily limits and per-account AI use |
| Diagnostics → Other Diagnostic Data | App Functionality | server error logs tied to the account |

Do **not** tick: location, contacts, browsing history, search history, health, financial info, sensitive info, advertising data, crash data, performance data. Tracking: **No**.

## App Review information

- **Sign-in required:** Yes. Demo account: the email and password you create for Apple (fill these in App Store Connect yourself; don't send them to me).
- **Notes** (paste; fill the two blanks):

```
RapidRecall AI is a study coach for students 13+. Sign in with the demo account below (email and password), or with Apple or Google.

The demo account already has one course ("Intro to Biology") with notes uploaded, so you can try a practice set right away: open the course chat and tap "Next 10".

Purchases:
• Student subscription (monthly or yearly, 1-week free trial): Courses & exams → Account → See Premium.
• Exam Pass ($29.99, 60 days, non-renewing): on that same screen, tap "Studying for a certification exam? See the exam pass".
• Restore Purchases is on the Account screen and on each purchase screen.

AI: content is sent to Anthropic (Claude) after the user consents on the first screen; lecture transcription uses OpenAI. Press and hold any coach reply to report it.

Account deletion: Courses & exams → Account → Delete my account (removes all server data).
```

- **Contact:** your name, phone and email.

## In-app purchases: attach to this version

On the version page, under **In-App Purchases and Subscriptions**, add all three: `studycoach.premium.monthly`, `studycoach.premium.yearly`, `rapidrecall.exampass.60d`. Apple only reviews a first purchase together with an app version. Each one needs its review screenshot (a picture of the paywall: I'll make these with the store screenshots).

## Screenshots

iPhone only (the app is iPhone-only, so no iPad screenshots). One set at **6.9"** (1320 × 2868) covers every iPhone size. Plan (3 to 6):

1. The coach chat after an upload: "Your notes are in. Want 10 questions?" Caption: *Your notes become questions*
2. A question card mid-set ("Question 4 of 10"). Caption: *10 at a time, in spare minutes*
3. A graded set with the reasons. Caption: *Know why, not just what*
4. The daily line ("40 of today's 100"). Caption: *100 a day until you get 100/100*
5. The review PDF. Caption: *A review sheet the day before your exam*
6. A certification exam by section. Caption: *Certification exams, by section*

Plus: one paywall screenshot for each purchase's review screenshot.

## Still needed before you submit (you)

1. **Demo account** with a course ("Intro to Biology") and some notes. Put its email and password in App Review Information yourself.
2. Attach the three purchases to the version (above).
3. Screenshots (in progress).

Done: contact email on the privacy policy and the /support page (D-160); the exam pass is reachable from the student price screen.
