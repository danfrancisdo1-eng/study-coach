import { router, type Href } from 'expo-router';

/**
 * Back that never dead-ends (D-093, Dan's screenshot: "The action 'GO_BACK' was not handled"):
 * whether there is a screen behind is decided at the tap, not when the screen first drew,
 * and with nothing behind it goes to `fallback` instead.
 */
export function goBack(fallback: Href = '/course-list'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
