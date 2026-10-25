import React, { useState } from 'react';
import { Pressable, StyleSheet, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useColors } from '@/hooks/useColors';
import { PRESS_SCALE, pressScaleAt } from '@/lib/press-scale';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The light tick every tap gives (D-200). For a text link or a tab, which are not a PressScale. */
export function tapHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
/** A text link's onPress with the tap tick first. */
export const withTap = <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => { tapHaptic(); fn(...args); };
export { PRESS_SCALE };

/**
 * A Pressable that squashes while pressed and springs back (D-179), with a light haptic tick
 * when the tap lands (D-200: on press, not press-in, so starting a scroll on a button does not tick). Drop-in for Pressable except that `style` must be a plain style or array, not
 * a function of `pressed`: the squash is the pressed look. With Reduce Motion on nothing
 * moves and the control dims instead. Disabled controls neither squash nor tick.
 * Answer cards pass `haptic={false}`; their right/wrong pattern follows the choice instead.
 * `gradient` paints the primary gradient (D-179) under the children, clipped to the control's
 * corner radius; the control's own `backgroundColor` stays as the fallback under it.
 */
export function PressScale({ scale = PRESS_SCALE.button, haptic = true, gradient = false, style, onPress, onPressIn, onPressOut, disabled, children, ...rest }: Omit<PressableProps, 'style' | 'children'> & {
  scale?: number;
  haptic?: boolean;
  gradient?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const down = useSharedValue(0);
  const [dim, setDim] = useState(false);
  const squash = useAnimatedStyle(() => ({ transform: [{ scale: pressScaleAt(scale, down.value) }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPress={onPress ? (e: GestureResponderEvent) => { if (haptic) tapHaptic(); onPress(e); } : undefined}
      onPressIn={(e: GestureResponderEvent) => {
        if (reduceMotion) setDim(true); else down.value = withTiming(1, { duration: 70 });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        if (reduceMotion) setDim(false); else down.value = withSpring(0, { damping: 14, stiffness: 420, mass: 0.6 });
        onPressOut?.(e);
      }}
      style={[style, gradient && styles.clip, reduceMotion ? (dim ? { opacity: 0.78 } : null) : squash]}
    >
      {gradient ? <LinearGradient pointerEvents="none" colors={[colors.primary, colors.primaryGradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
