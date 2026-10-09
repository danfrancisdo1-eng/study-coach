import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInUp, FadeOut, ZoomIn } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ONBOARDING_PAGES, ONBOARDING_SEEN_KEY } from '@/lib/onboarding';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { QuestionHero } from '@/components/onboarding/QuestionHero';
import { MemoryHero } from '@/components/onboarding/MemoryHero';
import { ReadinessHero } from '@/components/onboarding/ReadinessHero';
import { MaterialHero } from '@/components/onboarding/MaterialHero';

/**
 * The first-launch tour (D-049): five pages before sign-in, one hero each, built from the
 * app's own components rather than illustrations, and staged the way a finished product
 * does it: the hero enters first, then the title and line, with one button. Runs once per
 * phone (AsyncStorage), skippable after the agreement page, replayable from sign-in with
 * `?replay=1`. Pages crossfade; the heroes' entering animations follow Reduce Motion.
 */
export default function OnboardingScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const [page, setPage] = useState(0);
  const current = ONBOARDING_PAGES[page]!;
  const last = page === ONBOARDING_PAGES.length - 1;

  const finish = () => {
    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1').catch(() => {});
    if (replay === '1' && router.canGoBack()) router.back();
    else router.replace('/(auth)/sign-up');
  };
  const next = () => { if (last) finish(); else setPage(page + 1); };

  const hero = current.key === 'welcome' ? (
    <Animated.View entering={ZoomIn.delay(120).springify().damping(15)} style={styles.brandWrap} testID="hero-welcome">
      <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={38} color={colors.primaryForeground} /></View>
      <Text style={styles.brandName}>Study Coach</Text>
    </Animated.View>
  ) : current.key === 'exam' ? <QuestionHero />
    : current.key === 'memory' ? <MemoryHero />
    : current.key === 'readiness' ? <ReadinessHero />
    : <MaterialHero />;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 14) }]} testID="screen-onboarding">
      <LinearGradient colors={[colors.accent, colors.background, colors.background]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.topBar}>
        {page > 0 && !last ? (
          <Pressable accessibilityRole="button" onPress={finish} style={styles.skip} testID="button-onboarding-skip"><Text style={styles.skipText}>Skip</Text></Pressable>
        ) : null}
      </View>
      <View style={styles.pages}>
        <Animated.View key={current.key} entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={styles.page}>
          <View style={styles.heroArea}>{hero}</View>
          <Animated.Text entering={FadeInUp.delay(220).duration(420)} style={styles.title} accessibilityRole="header">{current.title}</Animated.Text>
          <Animated.Text entering={FadeInUp.delay(340).duration(420)} style={styles.line}>{current.line}</Animated.Text>
        </Animated.View>
      </View>
      <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${ONBOARDING_PAGES.length}`}>
        {ONBOARDING_PAGES.map((p, i) => <View key={p.key} style={[styles.dot, i === page && styles.dotActive]} />)}
      </View>
      {page === 0 ? (
        <Text style={styles.agreement}>
          By continuing you agree to the{' '}
          {PRIVACY_URL ? <Text style={styles.agreementLink} accessibilityRole="link" onPress={openPrivacy} testID="link-privacy">privacy policy</Text> : 'privacy policy'}
          {' '}and confirm you are 13 or older.
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={next} style={({ pressed }) => [styles.button, pressed && styles.pressed]} testID="button-onboarding-next">
        <Text style={styles.buttonText}>{current.button}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 22 },
  topBar: { minHeight: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  skip: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  skipText: { color: colors.mutedForeground, fontSize: 15, fontWeight: '600' },
  pages: { flex: 1 },
  // Absolute so the leaving page and the arriving page overlap during the crossfade.
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', gap: 10, paddingBottom: 8 },
  heroArea: { flex: 1, justifyContent: 'center', paddingBottom: 12 },
  brandWrap: { alignItems: 'center', gap: 14 },
  brandMark: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: colors.foreground, fontSize: 20, fontWeight: '600', letterSpacing: 0.2 },
  title: { color: colors.foreground, fontSize: 27, lineHeight: 33, letterSpacing: -0.5, fontWeight: '700' },
  line: { color: colors.mutedForeground, fontSize: 15.5, lineHeight: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 18, backgroundColor: colors.primary },
  agreement: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginBottom: 10 },
  agreementLink: { color: colors.primaryText, textDecorationLine: 'underline' },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  buttonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
