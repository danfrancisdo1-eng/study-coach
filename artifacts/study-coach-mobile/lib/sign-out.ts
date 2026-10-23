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

/** Where a sign-out goes first: the intro, which hands over to the tour and then the sign-in. */
export const SIGNED_OUT_ROUTE = '/intro' as const;
