import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * A labelled bar with its number (D-167, Dan: "I only want it one line ... all the percentages
 * to line up in the middle. You can't have it all zigzag, because then you can't compare").
 * The label gets one line at full size, cut with "…" (D-169: shrinking made long labels tiny); the value sits in a fixed
 * right-hand column, right-aligned, tabular digits, so every row's number is under the one
 * above; the bar runs under both. Used for "Topics tested" on the course page and "By section"
 * after a set. The caller picks the type (the set card uses its own faces) and the bar colour.
 */
export function StatRow({ label, value, fraction, fillColor, labelStyle, valueStyle, accessibilityLabel, maxFontSizeMultiplier, testID }: {
  label: string;
  /** Short: "8/10", "27.5%". It has to fit the column. */
  value: string;
  /** 0–1 share of the bar to fill. */
  fraction: number;
  fillColor?: string;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  maxFontSizeMultiplier?: number;
  testID?: string;
}) {
  const colors = useColors();
  const width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const;
  return (
    <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`} testID={testID}>
      <View style={styles.head}>
        <Text numberOfLines={1} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.label, { color: colors.foreground }, labelStyle]}>{label}</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.value, { color: colors.foreground }, valueStyle]}>{value}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.secondary }]}><View style={[styles.fill, { width, backgroundColor: fillColor ?? colors.primary }]} /></View>
    </View>
  );
}

export const STAT_VALUE_WIDTH = 64;

const styles = StyleSheet.create({
  row: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20 },
  value: { width: STAT_VALUE_WIDTH, textAlign: 'right', fontSize: 15, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5 },
});
