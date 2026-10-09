import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * The one-time welcome (D-047, Dan's mock 2026-10-09): the three steps in the order of the
 * real flow as short cards (gold bar, icon, title, one line of copy), one boundary line, the
 * primary button that opens the Add sheet, and a plain "explore first" line. It fits on one
 * screen with no scrolling on a normal iPhone; the ScrollView only kicks in on a small one.
 * Nothing about set formats, memory sheets or web lookup: those arrive as chips after the
 * first reply. It sits in the chat area of the coach screen; the composer under it stays
 * visible but dimmed until one of the two choices is made.
 */
const STEPS: { icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }[] = [
  { icon: 'book-open', title: 'Add a course or exam', body: 'college class or a cert like AWS or Microsoft, with an optional exam date.' },
  { icon: 'plus-circle', title: 'Add your material', body: 'notes, a syllabus, photos, a file, or record a lecture. Audio stays on the phone.' },
  { icon: 'message-circle', title: 'Talk to your coach', body: 'practice sets, timed exams, flashcards, and a straight readiness call.' },
];

export function Welcome({ onAddCourse, onExplore, busy = false }: { onAddCourse: () => void; onExplore: () => void; busy?: boolean }) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <ScrollView contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled" testID="panel-welcome">
      <View style={styles.top}>
        <Text style={styles.title} accessibilityRole="header">A tutor that has already read your material.</Text>
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={step.title} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}. ${step.title}: ${step.body}`} testID={`welcome-step-${i + 1}`}>
              <View style={styles.bar} />
              <Feather name={step.icon} size={34} color={colors.primaryText} style={styles.icon} />
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.boundary}>For students 13 and up. Study content is sent to the AI providers named on the consent card.</Text>
      </View>
      <View style={styles.bottom}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onAddCourse} style={({ pressed }) => [styles.primaryButton, busy && styles.disabled, pressed && !busy && styles.pressed]} testID="button-welcome-add">
          <Text style={styles.primaryButtonText}>Add a course or exam</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onExplore} style={({ pressed }) => [styles.textButton, busy && styles.disabled, pressed && !busy && styles.pressed]} testID="button-welcome-explore">
          <Text style={styles.textButtonText}>I'll explore first</Text>
        </Pressable>
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
  stepBody: { color: colors.mutedForeground, fontSize: 13.5, lineHeight: 18.5 },
  boundary: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  bottom: { gap: 2 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 12 },
  textButtonText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
