/** Sign-in title (review finding 11, D-084): "Welcome back." only on a phone that has signed in before. */
export const SIGNED_IN_BEFORE_KEY = 'study-coach-signed-in-before';

export function signInTitle(signedInBefore: boolean): string {
  return signedInBefore ? 'Welcome back.' : 'Sign in.';
}
