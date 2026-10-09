/**
 * The first-launch tour (D-049, trimmed in D-050): five pages before sign-in, once per phone,
 * replayable from the sign-in screen. One hero and one title per page, nothing else. The copy
 * lives here so it is testable and so the screen stays layout.
 */
export const ONBOARDING_SEEN_KEY = 'study-coach-onboarding-seen';

export const hasSeenOnboarding = (value: string | null | undefined): boolean => value === '1';

export type OnboardingPage = {
  key: 'intro' | 'exam' | 'memory' | 'readiness' | 'material';
  title: string;
  button: string;
};

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  { key: 'intro', title: 'A tutor that has already read your material.', button: 'Agree and continue' },
  { key: 'exam', title: 'Real exam format', button: 'Continue' },
  { key: 'memory', title: 'It remembers what you miss', button: 'Continue' },
  { key: 'readiness', title: 'Know when you are ready', button: 'Continue' },
  { key: 'material', title: 'Built from your material', button: 'Get started' },
];
