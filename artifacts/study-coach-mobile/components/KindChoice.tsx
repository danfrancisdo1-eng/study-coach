import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { PressScale } from '@/components/PressScale';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, interpolateColor } from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';

export type CourseKindChoice = 'course' | 'exam';

/**
 * D-158 (Dan: someone adding an exam "will mistakenly just click in to name the course/exam without
 * switching to exam"): no default. Until one is picked, the two outlines take turns glowing (a slow
 * pulse, well under three flashes a second); with Reduce Motion both simply show a strong outline.
 */
export function KindChoice({ value, onChange }: { value: CourseKindChoice | null; onChange: (kind: CourseKindChoice) => void }) {
  const colors = useColors();
  const reduceMotion = useReducedMotion();
  const phase = useSharedValue(0);
  const waiting = value === null;

  useEffect(() => {
    if (waiting && !reduceMotion) phase.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    else phase.value = 0;
  }, [waiting, reduceMotion]);

  // The two outlines take turns: course glows as exam fades, then the other way round.
  const courseGlow = useAnimatedStyle<ViewStyle>(() => ({ borderColor: interpolateColor(1 - phase.value, [0, 1], [colors.border, colors.primaryText]) }));
  const examGlow = useAnimatedStyle<ViewStyle>(() => ({ borderColor: interpolateColor(phase.value, [0, 1], [colors.border, colors.primaryText]) }));

  const item = (kind: CourseKindChoice, label: string, animated: typeof courseGlow) => {
    const selected = value === kind;
    return (
      <Animated.View style={[styles.item, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : waiting && reduceMotion ? colors.primaryText : colors.border }, waiting && !reduceMotion ? animated : null]}>
        <PressScale accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={() => onChange(kind)} style={styles.press} testID={`button-kind-${kind}`}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.text, { color: selected ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
        </PressScale>
      </Animated.View>
    );
  };

  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Course or certification exam">
      {item('course', 'Course', courseGlow)}
      {item('exam', 'Certification Exam', examGlow)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 10 },
  item: { flex: 1, borderRadius: 12, borderWidth: 2 },
  press: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  text: { fontSize: 15, fontWeight: '700' },
});
