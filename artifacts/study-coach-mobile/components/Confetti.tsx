import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { confettiKey } from '@/lib/perfect-score';

/**
 * A perfect score celebrates (D-100, spec A): a 2-second burst of confetti from the top, like
 * iMessage's "Congratulations", and a success haptic; once per graded set on this phone. With
 * Reduce Motion: no confetti, the haptic and a "Perfect score" line. Reanimated only, no package.
 */
const COLORS = ['#F2B544', '#4CAF7D', '#4F7CF7', '#E5566B', '#A66CF2', '#3CC8D8'];
const PIECES = 42;

function Piece({ index, width, height }: { index: number; width: number; height: number }) {
  const progress = useSharedValue(0);
  const seed = useMemo(() => ({
    x: Math.random() * width,
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() - 0.5) * 1080,
    delay: Math.random() * 300,
    size: 6 + Math.random() * 6,
    color: COLORS[index % COLORS.length]!,
    round: index % 3 === 0,
  }), [index, width]);
  useEffect(() => {
    progress.value = withDelay(seed.delay, withTiming(1, { duration: 1700, easing: Easing.out(Easing.quad) }));
  }, [progress, seed.delay]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value < 0.85 ? 1 : (1 - progress.value) / 0.15,
    transform: [
      { translateX: seed.x + seed.drift * progress.value },
      { translateY: -20 + (height * 0.75) * progress.value },
      { rotate: `${seed.spin * progress.value}deg` },
    ],
  }));
  return <Animated.View style={[styles.piece, { width: seed.size, height: seed.round ? seed.size : seed.size * 0.45, borderRadius: seed.round ? seed.size / 2 : 1, backgroundColor: seed.color }, style]} />;
}

export function Confetti({ sessionId, perfect }: { sessionId: string; perfect: boolean }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!perfect) return;
    let alive = true;
    AsyncStorage.getItem(confettiKey(sessionId)).then((seen) => {
      if (!alive || seen) return;
      AsyncStorage.setItem(confettiKey(sessionId), '1').catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setShow(true);
      setTimeout(() => { if (alive) setShow(false); }, 2300);
    }).catch(() => {});
    return () => { alive = false; };
  }, [perfect, sessionId]);
  if (!perfect) return null;
  if (reduceMotion) return <Text style={[styles.line, { color: colors.correct }]} accessibilityRole="text" testID="text-perfect-score">Perfect score</Text>;
  if (!show) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="confetti">
      {Array.from({ length: PIECES }, (_, i) => <Piece key={i} index={i} width={width} height={height} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 50, overflow: 'visible' },
  piece: { position: 'absolute', top: 0, left: 0 },
  line: { fontSize: 15, fontWeight: '700' },
});
