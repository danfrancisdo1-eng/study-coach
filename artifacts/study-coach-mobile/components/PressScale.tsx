import React, { useState } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { PRESS_SCALE, pressScaleAt } from '@/lib/press-scale';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export { PRESS_SCALE };

/**
 * A Pressable that squashes while pressed and springs back (D-179), with a light haptic tick
 * on press-in. Drop-in for Pressable except that `style` must be a plain style or array, not
 * a function of `pressed`: the squash is the pressed look. With Reduce Motion on nothing
 * moves and the control dims instead. Disabled controls neither squash nor tick.
 * Answer cards pass `haptic={false}`; their right/wrong pattern follows the choice instead.
 */
export function PressScale({ scale = PRESS_SCALE.button, haptic = true, style, onPressIn, onPressOut, disabled, ...rest }: Omit<PressableProps, 'style'> & {
  scale?: number;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const down = useSharedValue(0);
  const [dim, setDim] = useState(false);
  const squash = useAnimatedStyle(() => ({ transform: [{ scale: pressScaleAt(scale, down.value) }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        if (reduceMotion) setDim(true); else down.value = withTiming(1, { duration: 70 });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        if (reduceMotion) setDim(false); else down.value = withSpring(0, { damping: 14, stiffness: 420, mass: 0.6 });
        onPressOut?.(e);
      }}
      style={[style, reduceMotion ? (dim ? { opacity: 0.78 } : null) : squash]}
    />
  );
}
