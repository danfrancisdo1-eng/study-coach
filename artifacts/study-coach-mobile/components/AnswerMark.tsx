import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { AnswerKind } from '@/lib/answer-feedback';

/**
 * The rising mark after a graded answer (D-172, Dan: "the check could appear hovering over the
 * last letter at the letter's base, then rise to the top of the line and disappear"). Rendered
 * INSIDE the answer's Text, right after its last character, so it sits where the sentence ends
 * however the text wraps. A green ✓ or a red ✗ fades in on the baseline, rises one line height
 * over 650 ms while fading out, and is gone. With Reduce Motion it fades in and out in place.
 * The mark is decoration: the answer's own icon and colour (and its accessibility label) carry
 * the verdict, so it is hidden from VoiceOver.
 */
export function AnswerMark({ kind, lineHeight = 23, size = 18, play = true }: { kind: AnswerKind; lineHeight?: number; size?: number; play?: boolean }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const rise = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!play) return;
    rise.value = 0;
    opacity.value = 0;
    if (reduceMotion) {
      opacity.value = withSequence(withTiming(1, { duration: 150 }), withDelay(450, withTiming(0, { duration: 250 })));
      return;
    }
    opacity.value = withSequence(withTiming(1, { duration: 120 }), withDelay(230, withTiming(0, { duration: 300 })));
    rise.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [play, kind, reduceMotion, rise, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: -rise.value * lineHeight }, { scale: 0.9 + 0.25 * rise.value }],
  }));

  if (!play) return null;
  return (
    <View style={[styles.slot, { width: size + 6, height: lineHeight }]} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>
      <Animated.View style={[styles.mark, { bottom: 0 }, style]} pointerEvents="none">
        <Feather name={kind === 'correct' ? 'check' : 'x'} size={size} color={kind === 'correct' ? colors.correct : colors.wrong} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The inline slot keeps the line's height so the text does not jump; the mark floats inside it.
  slot: { overflow: 'visible', marginLeft: 2 },
  mark: { position: 'absolute', left: 4 },
});
