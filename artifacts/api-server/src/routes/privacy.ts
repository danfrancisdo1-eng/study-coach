// Public privacy policy page (D-046): the URL App Store Connect and TestFlight ask for, and
// what the app links to from sign-up and the AI consent card. The data inventory behind it
// is docs/PRIVACY_DATA.md; keep the two in step. Draft wording: Dan (or a lawyer) reviews
// before submission.
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const UPDATED = "2026-10-08";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Study Coach privacy policy</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px 16px 64px; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin-inline: auto; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 28px 0 8px; } p, li { margin: 0 0 10px; } ul { padding-left: 20px; }
  .muted { opacity: .7; font-size: .9rem; }
</style>
</head>
<body>
<h1>Study Coach privacy policy</h1>
<p class="muted">Last updated ${UPDATED}. This is a draft for review before the app is published.</p>

<p>Study Coach is a study companion for students aged 13 and older. It is built and operated by an individual developer. This page says what the app collects, why, where it goes, and how to delete it.</p>

<h2>What the app collects</h2>
<ul>
  <li><strong>Your account:</strong> the email address, and name if you share it, from the sign-in you choose (email and password, Apple, or Google). Sign-in is handled by Clerk.</li>
  <li><strong>Your study content:</strong> the courses and exams you add, the material you upload or photograph (notes, syllabi, slides, web pages), the questions and answers in your practice sets and flashcards, your memory sheet, and your conversation with the coach.</li>
  <li><strong>Lectures:</strong> audio you record stays on your phone. If you choose to transcribe a recording, the audio is sent for transcription and only the transcript is kept on our servers.</li>
  <li><strong>Usage needed to run the app:</strong> request logs with timestamps and error reports, kept for a limited time to keep the service working.</li>
</ul>
<p>The app does not collect your location, contacts, photos beyond the ones you pick, or advertising identifiers, and it does not show ads.</p>

<h2>How AI is used</h2>
<p>Before any of your content goes to an AI provider, the app asks for your consent and names the providers. Your messages, course names, selected materials and quiz answers are sent to <strong>Anthropic</strong> (Claude) to coach you, write practice questions and explain results. Lecture recordings you choose to transcribe are sent to <strong>OpenAI</strong> for transcription. These providers process the content to return a result; they are not permitted to use it to advertise to you. AI can make mistakes; the app shows you the explanation behind every answer and lets you report a question or a reply.</p>

<h2>Where it is stored</h2>
<p>Your account data and study content are stored on servers hosted by Render in the United States. Lecture audio is stored only on your device.</p>

<h2>Sharing</h2>
<p>Study Coach has no sharing feature: nothing you create is sent to anyone other than the service providers listed above. We do not sell personal information.</p>

<h2>Children</h2>
<p>Study Coach is for people aged 13 and older. You confirm your age when you create an account. If we learn that an account belongs to a child under 13, we delete it.</p>

<h2>Your choices</h2>
<ul>
  <li><strong>Delete your account</strong> from inside the app (Courses &amp; exams → Delete my account). This removes your courses, materials, sets, flashcards, memory sheet, conversations and transcripts from our servers, and your sign-in identity, within minutes.</li>
  <li><strong>Withdraw AI consent</strong> at any time by deleting your account, or by contacting us; the app cannot coach you without AI, so the consent screen returns.</li>
  <li><strong>Lecture audio</strong> is deleted by deleting the recording in the app or removing the app.</li>
</ul>

<h2>Contact</h2>
<p>Questions about this policy or your data: <em>[contact email to be added before publication]</em>.</p>

<h2>Changes</h2>
<p>If this policy changes in a way that matters, the app will tell you before the change applies to you.</p>
</body>
</html>`;

router.get("/privacy", (_req, res) => {
  res.type("html").send(html);
});

export default router;
