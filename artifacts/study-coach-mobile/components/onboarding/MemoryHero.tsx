import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInUp, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Tour page 3 (D-049): a memory-sheet row writes itself, then a flashcard built from it turns
 * over. The flip is a timed rotation; with Reduce Motion on, the card simply shows its back.
 */
export function MemoryHero() {
  const colors = useColors();
  const styles = createStyles(colors);
  const reduceMotion = useReducedMotion();
  const flip = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) { flip.value = 1; return; }
    flip.value = withDelay(1400, withTiming(1, { duration: 650, easing: Easing.inOut(Easing.cubic) }));
  }, [reduceMotion, flip]);
  const front = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }], opacity: flip.value < 0.5 ? 1 : 0 }));
  const back = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }], opacity: flip.value >= 0.5 ? 1 : 0 }));
  return (
    <View style={styles.wrap} testID="hero-memory">
      <Animated.View entering={FadeInUp.delay(200).duration(420)} style={styles.sheet}>
        <View style={styles.sheetHead}><Feather name="bookmark" size={14} color={colors.primaryText} /><Text style={styles.kicker}>Memory sheet</Text></View>
        <Text style={styles.term}>Cost variance</Text>
        <Text style={styles.trick}>EV − AC. Negative means over budget.</Text>
        <Text style={styles.caption}>When you see “over budget”, think negative CV.</Text>
      </Animated.View>
      <Animated.View entering={FadeInUp.delay(700).duration(420)} style={styles.deck}>
        <Animated.View style={[styles.face, front]}>
          <Text style={styles.faceKicker}>Flashcard 1 of 12</Text>
          <Text style={styles.faceTitle}>Cost variance</Text>
          <Text style={styles.caption}>Tap to turn over</Text>
        </Animated.View>
        <Animated.View style={[styles.face, styles.faceBack, back]}>
          <Text style={styles.faceKicker}>Answer</Text>
          <Text style={styles.faceTitle}>EV − AC</Text>
          <Text style={styles.caption}>Negative: over budget. Positive: under.</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 12 },
  sheet: { padding: 14, gap: 4, borderRadius: colors.radius, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  kicker: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  term: { color: colors.foreground, fontSize: 16, fontWeight: '700' },
  trick: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
  caption: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17 },
  deck: { height: 132 },
  face: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 16, justifyContent: 'center', gap: 4, borderRadius: colors.radius, backgroundColor: colors.reviewBg, backfaceVisibility: 'hidden' },
  faceBack: { backgroundColor: colors.navyBg }, // D-171: the flip keeps its navy
  faceKicker: { color: colors.reviewMuted, fontSize: 12, fontWeight: '600' },
  faceTitle: { color: colors.reviewText, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
});
