import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColors } from '@/hooks/useColors';
import { glassBorderColor, glassWashCss } from '@/lib/glass';

/**
 * Frosted glass for a card (D-179): the aurora and anything else behind the card shows through
 * a blur with a white (light mode) or ink (dark mode) wash over it, so text keeps its contrast
 * against the darkest thing that could sit behind. Put it first inside a card that has
 * `overflow: 'hidden'`, a transparent background and the `glassBorder` hairline. Android has no
 * cheap native blur, so it gets a near-opaque wash and keeps the hairline.
 */
export function GlassFill() {
  const colors = useColors();
  const dark = colors.scheme === 'dark';
  const ios = Platform.OS === 'ios';
  const wash = glassWashCss(colors.scheme, ios);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="glass-fill">
      {ios ? <BlurView intensity={40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} />
    </View>
  );
}

/** The card border that goes with GlassFill: a hairline of ink at 8% (light) or white at 10% (dark). */
export function glassBorder(scheme: 'light' | 'dark') {
  return { borderWidth: 1, borderColor: glassBorderColor(scheme), backgroundColor: 'transparent', overflow: 'hidden' as const };
}
