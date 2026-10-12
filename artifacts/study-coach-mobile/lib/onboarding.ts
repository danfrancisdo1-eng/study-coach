/**
 * The tour (D-049, trimmed in D-050, D-054): five pages before every sign-in (Dan: "not just
 * once per phone"), replayable from the sign-in screen and from Account. The seen key is still
 * written but no longer gates anything. One hero and one title per page, nothing else (no
 * subheadings, and the brand name is not repeated under the mark on the first page). The copy
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
  { key: 'intro', title: 'Welcome to Study Coach', button: 'Agree and continue' },
  { key: 'exam', title: 'Real exam format', button: 'Continue' },
  { key: 'memory', title: 'It remembers what you miss', button: 'Continue' },
  { key: 'readiness', title: 'Know when you are ready', button: 'Continue' },
  { key: 'material', title: 'Built from your material', button: 'Get started' },
];
