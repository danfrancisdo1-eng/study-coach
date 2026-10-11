import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkLoaded, ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// One face per import path: the packages' root index pulls every weight (≈1.5 MB each) into the bundle.
import { SourceSans3_400Regular } from '@expo-google-fonts/source-sans-3/400Regular';
import { SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3/600SemiBold';
import { SourceSans3_700Bold } from '@expo-google-fonts/source-sans-3/700Bold';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const domain = process.env.EXPO_PUBLIC_DOMAIN;
setBaseUrl(domain ? `https://${domain}` : null);

function AuthenticatedApiRuntime() {
  const { getToken, userId } = useAuth();
  const previousUserId = useRef<string | null | undefined>(undefined);

  setAuthTokenGetter(() => getToken());
  useLayoutEffect(() => {
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      queryClient.clear();
    }
    previousUserId.current = userId ?? null;
  }, [userId]);

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back', headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

function RootLayoutNav() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
  const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
      <ClerkLoaded>
        <AuthenticatedApiRuntime />
      </ClerkLoaded>
    </ClerkProvider>
  );
}

export default function RootLayout() {
  // System font (SF Pro) for the app's chrome (D-043). The question cards use Source Sans 3 and
  // Fraunces (D-053, constants/type.ts); the faces ship in the bundle and load in the background.
  // Nothing waits on them: the app opens at once and the splash goes on mount (2026-10-11, after
  // the app sat on a loading screen on Dan's phone). A card drawn before they land uses the
  // system font for that first frame, which is harmless; a load error changes nothing.
  useFonts({ SourceSans3_400Regular, SourceSans3_600SemiBold, SourceSans3_700Bold, Fraunces_600SemiBold });
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
