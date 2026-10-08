import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * The one-time welcome (D-047, Dan's spec 2026-10-08): the three steps in the order of the
 * real flow, one boundary line, the primary button that opens the Add sheet, and a plain
 * "explore first" line. Nothing about set formats, memory sheets or web lookup: those arrive
 * as chips after the first reply. It sits in the chat area of the coach screen; the
 * composer under it stays visible but dimmed until one of the two choices is made.
 */
const STEPS = [
  { title: 'Add a course or exam.', body: 'A college class, or a certification such as Microsoft or AWS. Optional exam date. For a cert, the app pulls the official guide and its section weights.' },
  { title: 'Add material, if you have it.', body: 'Notes, a syllabus, photos, a file, or a lecture recording from the + button. You can edit the extracted text before it saves. Lecture audio stays on the phone; only the transcript is stored.' },
  { title: 'Talk to the coach.', body: 'Practice sets and timed-style exams, grading with an explanation of every answer, flashcards from what you missed, and a readiness call. Each course keeps its own thread.' },
];

export function Welcome({ onAddCourse, onExplore, busy = false }: { onAddCourse: () => void; onExplore: () => void; busy?: boolean }) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="panel-welcome">
      <View style={styles.brandRow}>
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={21} color={colors.primaryForeground} /></View>
        <Text style={styles.eyebrow}>Study Coach</Text>
      </View>
      <Text style={styles.title} accessibilityRole="header">A tutor that has already read your material.</Text>
      <View style={styles.steps}>
        {STEPS.map((step, i) => (
          <View key={step.title} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}. ${step.title} ${step.body}`} testID={`welcome-step-${i + 1}`}>
            <View style={styles.badge}><Text style={styles.badgeText}>{i + 1}</Text></View>
            <View style={styles.stepCopy}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.boundary}>For students 13 and up. Study content is sent to the AI providers named on the consent card.</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onAddCourse} style={({ pressed }) => [styles.primaryButton, busy && styles.disabled, pressed && !busy && styles.pressed]} testID="button-welcome-add">
        <Feather name="plus" size={18} color={colors.primaryForeground} />
        <Text style={styles.primaryButtonText}>Add a course or exam</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onExplore} style={({ pressed }) => [styles.textButton, busy && styles.disabled, pressed && !busy && styles.pressed]} testID="button-welcome-explore">
        <Text style={styles.textButtonText}>I'll explore first</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, gap: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.primaryText, fontSize: 14, fontWeight: '600' },
  title: { color: colors.foreground, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, fontWeight: '700' },
  steps: { gap: 10 },
  // Cards 16 (theme radius), number badge in the chip tint so the accent stays on the button.
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: colors.radius, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.chipBorder, marginTop: 1 },
  badgeText: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  stepCopy: { flex: 1, gap: 3 },
  stepTitle: { color: colors.foreground, fontSize: 15.5, fontWeight: '700' },
  stepBody: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  boundary: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 18 },
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 12 },
  textButtonText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
