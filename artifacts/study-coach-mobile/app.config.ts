// D-143 (Dan: "dev app"): the development build gets its own app ID and name, so it sits next to the
// TestFlight app on the iPhone instead of replacing it (installing TestFlight build 5 had replaced it).
// Everything else comes from app.json. EAS sets APP_VARIANT=development for the development profile
// (eas.json); the preview script sets it too. The URL scheme stays the same for sign-in.
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const dev = process.env.APP_VARIANT === 'development';
  if (!dev) return config as ExpoConfig;
  return {
    ...config,
    name: 'RapidRecall Dev',
    ios: { ...config.ios, bundleIdentifier: 'com.danfrancis.studycoach.dev' },
    android: { ...config.android, package: 'com.danfrancis.studycoach.dev' },
  } as ExpoConfig;
};
