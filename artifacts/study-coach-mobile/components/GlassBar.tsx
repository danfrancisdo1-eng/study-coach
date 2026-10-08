import React from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColors } from '@/hooks/useColors';

/**
 * The one frosted-glass panel (D-048): a strip the chat scrolls under. Native blur with the
 * system chrome material for the current appearance, a 1 px inset highlight along the top
 * edge and a hairline under it. The web clip's SVG displacement ("glass that bends") has no
 * native equivalent, so this is blur + saturation only. Android has no cheap native blur, so
 * it gets a near-opaque strip in the background color instead.
 */
export function GlassBar({ children, style, onLayout }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
  const colors = useColors();
  const dark = colors.scheme === 'dark';
  return (
    <View style={[styles.bar, style]} onLayout={onLayout} testID="glass-bar">
      {Platform.OS === 'ios'
        ? <BlurView intensity={60} tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'} style={StyleSheet.absoluteFill} />
        : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, opacity: 0.94 }]} />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderTopWidth: 1, borderTopColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { overflow: 'hidden' },
});
