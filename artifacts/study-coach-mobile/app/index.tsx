import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const colors = useColors();
  if (!isLoaded) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primaryText} />
    </View>;
  }
  // Signed out means a new login is coming, and every new login sees the tour first (D-054, Dan:
  // "not just once per phone ever"). Skip on the tour goes to sign-in; Get started to sign-up.
  return <Redirect href={isSignedIn ? '/(tabs)' : '/onboarding'} />;
}
