/**
 * The first-launch tour (D-049): five pages before sign-in, once per phone, replayable from
 * the sign-in screen. The copy lives here so it is testable and so the screen stays layout.
 * Tone: for certification candidates and students alike; no mascots, no hype.
 */
export const ONBOARDING_SEEN_KEY = 'study-coach-onboarding-seen';

export const hasSeenOnboarding = (value: string | null | undefined): boolean => value === '1';

export type OnboardingPage = {
  key: 'welcome' | 'exam' | 'memory' | 'readiness' | 'material';
  title: string;
  line: string;
  button: string;
};

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  { key: 'welcome', title: 'Welcome to Study Coach', line: 'A tutor that has already read your material. For certification candidates and students: name the exam or the course, add what you have, and start.', button: 'Agree and continue' },
  { key: 'exam', title: 'Real exam format', line: 'Practice sets and timed exams written the way the real test is, graded with an explanation of every answer.', button: 'Continue' },
  { key: 'memory', title: 'It remembers what you miss', line: 'Flashcards from your misses, and a memory trick for each one.', button: 'Continue' },
  { key: 'readiness', title: 'Know when you are ready', line: 'Scores over time and a straight readiness call, not a guess.', button: 'Continue' },
  { key: 'material', title: 'Built from your material', line: 'Notes, a syllabus, photos, a file, or a lecture recording. Audio stays on the phone.', button: 'Get started' },
];
