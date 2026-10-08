// The public privacy policy is served by the API (artifacts/api-server/src/routes/privacy.ts),
// so the link follows the same domain the app already talks to. Null in a dev build with no
// domain set: callers hide the link rather than open a dead one.
import { Linking } from 'react-native';

const domain = process.env.EXPO_PUBLIC_DOMAIN;
export const PRIVACY_URL: string | null = domain ? `https://${domain}/privacy` : null;

export function openPrivacy(): void {
  if (PRIVACY_URL) Linking.openURL(PRIVACY_URL).catch(() => {});
}
