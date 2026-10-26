import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import type { RevealStep } from '@/lib/lesson-chat';

/**
 * A report card section title (D-203, Dan: "have that title slide in, and then it just start, that'll
 * actually give the AI time to respond"): it slides in from the right, a line draws across under it,
 * three soft dots pulse, then the section's text fades in. `step` says when each part starts (null: drawn
 * at once, e.g. an older message). Reduce Motion: no sliding or drawing, the text fades in.
 */
export function SectionTitle({ title, step, style, textStyle }: { title: string; step: RevealStep | null; style?: StyleProp<ViewStyle>; textStyle?: object }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const moving = !!step && !reduceMotion;
  const slide = useSharedValue(moving && step!.title + step!.line > 0 ? 0 : 1);
  const line = useSharedValue(moving && step!.line > 0 ? 0 : 1);
  useEffect(() => {
    if (!moving || !step) return;
    if (slide.value < 1) slide.value = withDelay(step.title, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    if (line.value < 1) line.value = withDelay(step.line, withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }));
  }, []);
  const titleStyle = useAnimatedStyle(() => ({ opacity: slide.value, transform: [{ translateX: (1 - slide.value) * 56 }] }));
  const lineStyle = useAnimatedStyle(() => ({ width: `${line.value * 100}%` }));
  return (
    <View style={[styles.wrap, style]}>
      <Animated.View style={titleStyle}>
        <Text style={textStyle} accessibilityRole="header">{title}</Text>
      </Animated.View>
      <View style={styles.track}>
        <Animated.View style={[styles.line, { backgroundColor: colors.primaryText }, lineStyle]} />
      </View>
    </View>
  );
}

/** A section's text: three dots, then the text fades in (at once when `step` is null). */
export function SectionBody({ step, children }: { step: RevealStep | null; children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const later = !!step && step.body > 0;
  const shown = useSharedValue(later ? 0 : 1);
  useEffect(() => {
    if (!later || !step) return;
    shown.value = withDelay(reduceMotion ? 0 : step.body, withTiming(1, { duration: reduceMotion ? 200 : 320 }));
  }, []);
  const bodyStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 6 }] }));
  const dotsStyle = useAnimatedStyle(() => ({ opacity: shown.value > 0 ? 0 : 1 }));
  return (
    <View>
      {later && !reduceMotion ? <Animated.View style={[styles.dotsOverlay, dotsStyle]} pointerEvents="none"><ThinkingDots delay={step!.dots} /></Animated.View> : null}
      <Animated.View style={bodyStyle}>{children}</Animated.View>
    </View>
  );
}

/** Three soft dots that pulse in turn: the coach is thinking. Still dots under Reduce Motion. */
export function ThinkingDots({ delay = 0, testID }: { delay?: number; testID?: string }) {
  const colors = useColors();
  return (
    <View style={styles.dots} accessibilityLabel="Coach is thinking" accessibilityRole="progressbar" testID={testID}>
      {[0, 1, 2].map((i) => <Dot key={i} delay={delay + i * 160} color={colors.mutedForeground} />)}
    </View>
  );
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const reduceMotion = useReducedMotion();
  // Hidden until its turn (a later section's dots wait for its title), then a soft pulse.
  const appear = useSharedValue(reduceMotion ? 1 : 0);
  const pulse = useSharedValue(reduceMotion ? 0.6 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    appear.value = withDelay(delay, withTiming(1, { duration: 200 }));
    pulse.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.25, { duration: 420 })), -1, false));
    return () => { cancelAnimation(pulse); cancelAnimation(appear); };
  }, [reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: appear.value * (0.25 + pulse.value * 0.75) }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/** What shows while the coach writes the report card: the first title comes in, then the dots wait for the text. */
export function EvaluationPlaceholder({ title, textStyle }: { title: string; textStyle?: object }) {
  return (
    <View style={styles.placeholder} testID="report-placeholder">
      <SectionTitle title={title} step={{ title: 0, line: 420, dots: 800, body: 0 }} textStyle={textStyle} />
      <ThinkingDots delay={800} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  track: { height: 2, borderRadius: 1, overflow: 'hidden' },
  line: { height: 2, borderRadius: 1, opacity: 0.55 },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center', height: 20, paddingLeft: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  dotsOverlay: { position: 'absolute', top: 0, left: 0 },
  placeholder: { gap: 8, paddingVertical: 6 },
});
