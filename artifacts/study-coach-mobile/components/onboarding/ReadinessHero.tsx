import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Tour page 4 (D-049): three scores grow in order, the last one in the accent, then the
 * readiness call stamps in. With Reduce Motion on the bars stand at full height at once.
 */
const SCORES = [{ day: 'Sep 30', score: 62 }, { day: 'Oct 4', score: 78 }, { day: 'Oct 8', score: 91 }];
const MAX_HEIGHT = 128;

function Bar({ index, score, grown }: { index: number; score: number; grown: boolean }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const height = useSharedValue(reduceMotion ? (score / 100) * MAX_HEIGHT : 0);
  useEffect(() => {
    if (!grown) return;
    const target = (score / 100) * MAX_HEIGHT;
    height.value = reduceMotion ? target : withDelay(350 + index * 260, withTiming(target, { duration: 650, easing: Easing.out(Easing.cubic) }));
  }, [grown, index, score, reduceMotion, height]);
  const grow = useAnimatedStyle(() => ({ height: height.value }));
  const last = index === SCORES.length - 1;
  return (
    <View style={barStyles.col}>
      <Animated.Text entering={FadeIn.delay(850 + index * 260).duration(300)} style={[barStyles.value, { color: last ? colors.primaryText : colors.mutedForeground }]}>{score}%</Animated.Text>
      <View style={barStyles.track}>
        <Animated.View style={[barStyles.bar, { backgroundColor: last ? colors.primary : colors.secondary }, grow]} />
      </View>
      <Text style={[barStyles.day, { color: colors.mutedForeground }]}>{SCORES[index]!.day}</Text>
    </View>
  );
}

const barStyles = StyleSheet.create({
  col: { flex: 1, alignItems: 'center', gap: 6 },
  value: { fontSize: 13, fontWeight: '700' },
  track: { height: MAX_HEIGHT, width: 44, justifyContent: 'flex-end' },
  bar: { width: 44, borderRadius: 10 },
  day: { fontSize: 11.5 },
});

export function ReadinessHero() {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.card} testID="hero-readiness">
      <View style={styles.head}>
        <Text style={styles.kicker}>Progress · 3 sets</Text>
        <Animated.View entering={ZoomIn.delay(1650).springify().damping(13)} style={styles.badge}>
          <Feather name="check" size={13} color={colors.primaryForeground} />
          <Text style={styles.badgeText}>Ready</Text>
        </Animated.View>
      </View>
      <View style={styles.bars}>
        {SCORES.map((s, i) => <Bar key={s.day} index={i} score={s.score} grown />)}
      </View>
      <Animated.Text entering={FadeIn.delay(1900).duration(400)} style={styles.caption}>Weak spot last time: schedule variance. Nothing missed this time.</Animated.Text>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { alignSelf: 'stretch', padding: 16, gap: 12, borderRadius: colors.radius, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  kicker: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.primary },
  badgeText: { color: colors.primaryForeground, fontSize: 12.5, fontWeight: '700' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 8 },
  caption: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17 },
});
