import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';

/**
 * A rotating gold ring (D-048, the "comet" variant of Dan's glow border), shown only while the
 * coach is working: a square gradient sheet, larger than the box's diagonal so the corners stay
 * covered, spins behind an opaque inner card, and only the `thickness` of edge shows. No native
 * conic gradient exists, so the bright end of a linear gradient sweeps the ring instead. With
 * Reduce Motion on, the ring is a still gold border. Idle, the ring is transparent and the inner
 * card keeps its geometry, so nothing jumps when the coach starts or stops.
 */
export function GlowRing({ active, radius = 16, thickness = 2, style, children }: {
  active: boolean;
  radius?: number;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const angle = useSharedValue(0);
  const spinning = active && !reduceMotion;
  useEffect(() => {
    if (!spinning) { cancelAnimation(angle); angle.value = 0; return; }
    angle.value = withRepeat(withTiming(360, { duration: 1500, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(angle);
  }, [spinning, angle]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  const side = Math.ceil(Math.hypot(box.width, box.height)) + 8;
  return (
    <View onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} style={[{ borderRadius: radius, padding: thickness, overflow: 'hidden' }, style]} testID={active ? 'glow-ring-active' : 'glow-ring'}>
      {active && reduceMotion ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }]} /> : null}
      {spinning && box.width > 0 ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: side, height: side, left: (box.width - side) / 2, top: (box.height - side) / 2 }, spin]}>
          <LinearGradient colors={['transparent', 'transparent', colors.primary]} locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      <View style={{ borderRadius: Math.max(radius - thickness, 0), overflow: 'hidden', backgroundColor: colors.background }}>{children}</View>
    </View>
  );
}
