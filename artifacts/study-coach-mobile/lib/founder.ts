/**
 * The founder story (D-181), from Dan's own post: no formal AI education, no coding background,
 * no AI-engineering experience; two AI certifications within three days (Sep 28 and Sep 30) by studying the way the
 * app works. The credentials are named; no credential ID appears anywhere in the app.
 */
export type Credential = { name: string; issuer: string; issued: string };

export const FOUNDER_CREDENTIALS: Credential[] = [
  { name: 'Generative AI Leader', issuer: 'Google Cloud', issued: 'Sep 28, 2026' },
  { name: 'Certified Professional: Agentic AI', issuer: 'NVIDIA', issued: 'Sep 30, 2026' },
];

export const FOUNDER_STORY: string[] = [
  'In September I passed two AI certifications within three days: the Google Cloud Generative AI Leader and the NVIDIA-Certified Professional: Agentic AI. The NVIDIA exam is built for people who work with agentic AI systems every day. I had no formal AI education, no coding background, and no experience as an AI engineer.',
  "So I used AI to teach me. Scenario-based practice questions, over and over. Memory tricks for the things that wouldn't stick. Quick review sessions. And above all, going back to the concepts I kept getting wrong until they clicked, instead of re-reading what I already knew.",
  'It worked, twice. RapidRecall is that method, built into an app, for your class or your exam.',
];

export const FOUNDER_SIGNATURE = 'Dan Francis, founder';

/** The one line on the paywall. */
export const FOUNDER_QUOTE = "I passed two AI certifications in three days with no AI background, studying exactly this way. That's why I built RapidRecall.";
