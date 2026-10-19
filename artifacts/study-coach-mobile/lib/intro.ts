/**
 * Intro video (D-134, D-150, D-152): Dan's 23-second intro plays full screen before the welcome tour
 * every time someone has to sign in (a new download, a sign-out, a deleted account; Dan: "make it play
 * if they sign out and need to sign back in"), with Skip always on screen and sound off until tapped.
 * Account replays it.
 */
export const introBeforeTour = (params: { replay?: string; fromIntro?: string }): boolean => params.replay !== '1' && params.fromIntro !== '1';

/** Where the intro hands over: the tour (marked so it does not send the student back), or back where the replay came from. */
export const afterIntro = (replay: boolean): '/onboarding?fromIntro=1' | 'back' => (replay ? 'back' : '/onboarding?fromIntro=1');
