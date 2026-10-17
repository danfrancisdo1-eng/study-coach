import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { TYPE } from '@/constants/type';

/**
 * A waiting bar that fills left to right (D-126). `fraction` 0–1; the label always says in words
 * what is happening (never colour or motion alone). With Reduce Motion on, the fill jumps instead
 * of gliding. Estimates are passed in by the caller and never reach 1 until the job is done.
 */
export function ProgressBar({ fraction, label, testID }: { fraction: number; label: string; testID?: string }) {
  const colors = useColors();
  const styles = createStyles(colors);
  const reduceMotion = useReducedMotion();
  const clamped = Math.min(1, Math.max(0, fraction));
  const width = useSharedValue(clamped);
  useEffect(() => {
    width.value = reduceMotion ? clamped : withTiming(clamped, { duration: 450, easing: Easing.out(Easing.quad) });
  }, [clamped, reduceMotion, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View style={styles.wrap} accessible accessibilityRole="progressbar" accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }} testID={testID ?? 'progress-bar'}>
      <View style={styles.track}><Animated.View style={[styles.fill, fill]} /></View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

/** Milliseconds since `active` became true (ticks twice a second; 0 while inactive). */
export function useElapsed(active: boolean): number {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) { setStart(null); return; }
    const begun = Date.now();
    setStart(begun);
    setNow(begun);
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return start === null ? 0 : Math.max(0, now - start);
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: { gap: 6, alignSelf: 'stretch' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.secondary, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  label: { ...TYPE.small, color: colors.mutedForeground },
});
