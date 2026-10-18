/**
 * Intro video (D-134, D-150): Dan's 23-second intro plays full screen once, the first time the app
 * ever opens on this phone (before the tour), with Skip always on screen and sound off until tapped.
 * Account replays it. The seen flag lives on the phone, so a reinstall shows it again.
 */
export const INTRO_SEEN_KEY = 'rapidrecall-intro-seen';

export const shouldPlayIntro = (seen: string | null | undefined): boolean => seen !== '1';

/** Where the intro hands over: the tour on first launch, or back where the replay came from. */
export const afterIntro = (replay: boolean): '/onboarding' | 'back' => (replay ? 'back' : '/onboarding');
