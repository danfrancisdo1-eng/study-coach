import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, SlideInRight, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { PressScale } from '@/components/PressScale';

/**
 * The welcome for an account with no course yet (D-047, D-055): the three steps in the order
 * of the real flow, each numbered, sliding in from the right one after another with a small
 * bounce as it lands (the first at once, then one every two seconds), one boundary line, the
 * "1st  Add a course or exam" button whose outline blinks once the boxes are in. It shows every
 * launch until a course or exam exists (D-055), so the motion only ever plays for a new account.
 * With Reduce Motion on, the boxes appear in the same rhythm without sliding and the outline stays
 * lit. It sits in the chat area of the coach screen; D-181: the message box under it is live
 * ("Or ask your coach anything"), so a student who is not ready to add a course can ask instead
 * (the "I'll explore first" line it replaces did nothing).
 */
const STEP_GAP_MS = 2000; // Dan: "after 2 seconds have the second box slide in"
const STEPS: { ordinal: string; icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }[] = [
  { ordinal: '1st', icon: 'book-open', title: 'Add a course or exam', body: 'with an optional exam date.' },
  { ordinal: '2nd', icon: 'plus-circle', title: 'Add your material', body: 'notes, a syllabus, photos, a file, or record a lecture. Audio stays on the phone.' },
  { ordinal: '3rd', icon: 'message-circle', title: 'Talk to your coach', body: 'practice sets, timed exams, flashcards, and a straight readiness call.' },
];

export function Welcome({ onAddCourse, busy = false }: { onAddCourse: () => void; busy?: boolean }) {
  const colors = useColors();
  const styles = createStyles(colors);
  const reduceMotion = useReducedMotion();
  // The button's outline blinks once the third box has landed; a still outline with Reduce Motion.
  const blink = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) { blink.value = 1; return; }
    blink.value = withDelay(STEP_GAP_MS * STEPS.length, withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => cancelAnimation(blink);
  }, [reduceMotion, blink]);
  const outline = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <ScrollView contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled" testID="panel-welcome">
      <View style={styles.top}>
        <Text style={styles.title} accessibilityRole="header">A tutor that has already read your material.</Text>
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <Animated.View key={step.title} entering={SlideInRight.delay(i * STEP_GAP_MS).duration(320).easing(Easing.out(Easing.back(1.15)))} style={styles.step}
              accessible accessibilityLabel={`${step.ordinal}. ${step.title}: ${step.body}`} testID={`welcome-step-${i + 1}`}>
              <View style={styles.bar} />
              <Feather name={step.icon} size={34} color={colors.primaryText} style={styles.icon} />
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}><Text style={styles.ordinal}>{step.ordinal}</Text>  {step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
        <Text style={styles.boundary}>For students 13 and up. Your study content goes to an AI service; you'll be asked to agree before anything is sent.</Text>
      </View>
      <View style={styles.bottom}>
        <View style={styles.primaryWrap}>
          <Animated.View pointerEvents="none" style={[styles.primaryOutline, outline]} />
          <PressScale gradient accessibilityRole="button" accessibilityLabel="1st. Add a course or exam" disabled={busy} onPress={onAddCourse} style={[styles.primaryButton, busy && styles.disabled]} testID="button-welcome-add">
            <Text style={styles.primaryButtonText}><Text style={styles.primaryOrdinal}>1st</Text>  Add a course or exam</Text>
          </PressScale>
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  // flexGrow + space-between: the button block sits at the bottom of the chat area, above the composer.
  content: { flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6, gap: 12 },
  top: { gap: 12 },
  title: { color: colors.foreground, fontSize: 23, lineHeight: 29, letterSpacing: -0.4, fontWeight: '600' },
  steps: { gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingRight: 12, paddingLeft: 10, borderRadius: colors.radius, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary },
  icon: { width: 40, textAlign: 'center' },
  stepCopy: { flex: 1, gap: 2 },
  stepTitle: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  ordinal: { color: colors.primaryText },
  stepBody: { color: colors.mutedForeground, fontSize: 13.5, lineHeight: 18.5 },
  boundary: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  bottom: { gap: 2 },
  primaryWrap: { position: 'relative' },
  // The blinking outline: a ring 3 pt outside the button, faded in and out; its opacity is the only thing that moves.
  primaryOutline: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 18, borderWidth: 2, borderColor: colors.primary },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  primaryOrdinal: { fontSize: 14 },
  disabled: { opacity: 0.45 },
});
