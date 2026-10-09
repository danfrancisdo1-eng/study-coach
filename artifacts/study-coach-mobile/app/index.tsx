import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '@/hooks/useColors';
import { ONBOARDING_SEEN_KEY, hasSeenOnboarding } from '@/lib/onboarding';

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const colors = useColors();
  // The first launch on this phone opens the tour (D-049); after that, sign-in as before.
  const [seenTour, setSeenTour] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY).then((value) => setSeenTour(hasSeenOnboarding(value))).catch(() => setSeenTour(true));
  }, []);
  if (!isLoaded || seenTour === null) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primaryText} />
    </View>;
  }
  return <Redirect href={isSignedIn ? '/(tabs)' : seenTour ? '/(auth)/sign-in' : '/onboarding'} />;
}
