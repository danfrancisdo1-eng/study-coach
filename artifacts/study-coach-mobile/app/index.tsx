import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { ActivityIndicator, View } from 'react-native';
import { getGetStudyStateQueryKey, useGetStudyState } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { homeRoute } from '@/lib/home';
import { INTRO_SEEN_KEY, shouldPlayIntro } from '@/lib/intro';

export default function Index() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const colors = useColors();
  // D-150: the intro video plays once, the first time the app ever opens (before the tour).
  const [introSeen, setIntroSeen] = useState<string | null | undefined>(undefined);
  useEffect(() => { AsyncStorage.getItem(INTRO_SEEN_KEY).then(setIntroSeen, () => setIntroSeen('1')); }, []);
  // The account's study state decides the home (D-056); the same query key the screens use, so it is fetched once.
  const stateQuery = useGetStudyState({ query: { queryKey: [...getGetStudyStateQueryKey(), userId], enabled: !!userId && isSignedIn === true } });
  if (!isLoaded || (isSignedIn && stateQuery.isLoading) || (!isSignedIn && introSeen === undefined)) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primaryText} />
    </View>;
  }
  // Signed out means a new login is coming, and every new login sees the tour first (D-054).
  if (!isSignedIn) return <Redirect href={shouldPlayIntro(introSeen) ? '/intro' : '/onboarding'} />;
  // A returning account lands on the course list; an empty one on the coach screen with the welcome (D-056).
  // A failed load goes to the coach screen too, which shows the error and a Retry.
  return <Redirect href={homeRoute(stateQuery.data?.state)} />;
}
