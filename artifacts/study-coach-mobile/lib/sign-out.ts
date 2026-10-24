/**
 * Signing out in the right order (D-180). On build 14 the crash screen showed for one render
 * while the tab screens and the account vanished at the same moment. So the app leaves the
 * tabs first (the intro is where a signed-out student lands anyway, D-152) and only then drops
 * the session; by the time the user id is gone, nothing that depends on it is on screen.
 * Pure so the order is testable: `leave` runs before `signOut`, and a failed sign-out is
 * reported, never swallowed.
 */
export async function signOutInOrder(leave: () => void, signOut: () => Promise<unknown>): Promise<'signed-out' | 'failed'> {
  leave();
  try {
    await signOut();
    return 'signed-out';
  } catch {
    return 'failed';
  }
}

/**
 * Where a sign-out goes first. D-191 (Dan): straight to the sign-in page, no intro or tour (a
 * cold start while signed out still plays them, D-152). signingOut=1 tells the sign-in page the
 * session is still being dropped, so it waits instead of sending a still-signed-in user home.
 */
export const SIGNED_OUT_ROUTE = { pathname: '/(auth)/sign-in', params: { signingOut: '1' } } as const;

/** What the sign-in page shows: a spinner while a sign-out finishes, home when signed in, else the form. */
export function signInLanding(isSignedIn: boolean | undefined, signingOut: boolean): 'wait' | 'home' | 'form' {
  if (isSignedIn) return signingOut ? 'wait' : 'home';
  return 'form';
}
