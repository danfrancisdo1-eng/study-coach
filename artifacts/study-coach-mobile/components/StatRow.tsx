import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { SCORE_REVEAL } from '@/lib/count-up';

/**
 * A labelled bar with its number (D-167, Dan: "I only want it one line ... all the percentages
 * to line up in the middle. You can't have it all zigzag, because then you can't compare").
 * The label gets one line at full size, cut with "…" (D-169: shrinking made long labels tiny); the value sits in a fixed
 * right-hand column, right-aligned, tabular digits, so every row's number is under the one
 * above; the bar runs under both. Used for "Topics tested" on the course page and "By section"
 * after a set. The caller picks the type (the set card uses its own faces) and the bar colour.
 *
 * D-179: with `revealDelayMs` the bar fills from the left after that delay, and `glow` gives a
 * strong bar a brighter leading edge and a soft halo. Reduce Motion: the bar is full at once.
 */
export function StatRow({ label, value, fraction, fillColor, glow, revealDelayMs, labelStyle, valueStyle, accessibilityLabel, maxFontSizeMultiplier, testID }: {
  label: string;
  /** Short: "8/10", "27.5%". It has to fit the column. */
  value: string;
  /** 0–1 share of the bar to fill. */
  fraction: number;
  fillColor?: string;
  /** A bright leading edge and halo: for bars that mean "strong". */
  glow?: boolean;
  /** Animate the fill from 0 after this many ms; omit for a still bar. */
  revealDelayMs?: number;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  maxFontSizeMultiplier?: number;
  testID?: string;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const animate = revealDelayMs !== undefined && !reduceMotion;
  const width = useSharedValue(animate ? 0 : percent);
  useEffect(() => {
    width.value = animate
      ? withDelay(revealDelayMs, withTiming(percent, { duration: SCORE_REVEAL.barFillMs, easing: Easing.out(Easing.cubic) }))
      : percent;
  }, [animate, percent, revealDelayMs, width]);
  const fillWidth = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  const base = fillColor ?? colors.primary;
  // The leading edge is the lighter indigo: the gradient end in light mode, the primary itself in dark mode.
  const edge = colors.scheme === 'dark' ? colors.primary : colors.primaryGradientEnd;
  const tail = colors.scheme === 'dark' ? colors.primaryGradientEnd : base;
  return (
    <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`} testID={testID}>
      <View style={styles.head}>
        <Text numberOfLines={1} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.label, { color: colors.foreground }, labelStyle]}>{label}</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.value, { color: colors.foreground }, valueStyle]}>{value}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.secondary }]}>
        <Animated.View style={[styles.fill, { backgroundColor: base }, glow && Platform.OS === 'ios' && { shadowColor: edge, shadowOpacity: 0.75, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }, fillWidth]}>
          {glow ? <LinearGradient pointerEvents="none" colors={[tail, edge]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} /> : null}
        </Animated.View>
      </View>
    </View>
  );
}

export const STAT_VALUE_WIDTH = 64;

const styles = StyleSheet.create({
  row: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20 },
  value: { width: STAT_VALUE_WIDTH, textAlign: 'right', fontSize: 15, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // No overflow clip on the track: a glowing fill's halo has to show past the 5-pt bar.
  track: { height: 5, borderRadius: 3 },
  fill: { height: 5, borderRadius: 3, overflow: 'hidden' },
});
