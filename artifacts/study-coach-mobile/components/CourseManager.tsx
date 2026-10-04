import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { courseConfirmWord, matchesCourseConfirmWord } from '@/lib/course-delete-confirm';

export type ManagedMaterial = { id: string; name: string; extractionFormat?: string };

/**
 * Shown inside "Edit course": the course's saved materials, each deletable, and a
 * separated, typed-confirmation "Delete course" (UX: destructive actions are small,
 * separated and confirmed).
 */
export function CourseManager({ courseName, materials, busy, onDeleteMaterial, onDeleteCourse }: {
  courseName: string;
  materials: ManagedMaterial[];
  busy: boolean;
  onDeleteMaterial: (material: ManagedMaterial) => Promise<void>;
  onDeleteCourse: () => Promise<void>;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const confirmWord = courseConfirmWord(courseName);
  const matches = matchesCourseConfirmWord(typed, courseName);

  const confirmMaterial = (material: ManagedMaterial) => {
    Alert.alert(
      `Delete “${material.name}”?`,
      `Tutoring and quizzes for ${courseName} will stop using it. This can’t be undone.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void onDeleteMaterial(material) }],
    );
  };

  return (
    <View style={styles.wrap} testID="panel-course-manager">
      <Text style={styles.title}>Materials in this course</Text>
      {materials.length === 0 ? <Text style={styles.caption}>No saved materials yet.</Text> : null}
      {materials.map((material) => (
        <View key={material.id} style={styles.row} testID={`row-material-${material.id}`}>
          <Feather name="file-text" size={16} color={colors.mutedForeground} />
          <Text style={styles.name} numberOfLines={2}>{material.name}</Text>
          <Pressable
            accessibilityRole="button" accessibilityLabel={`Delete ${material.name}`} disabled={busy}
            onPress={() => confirmMaterial(material)} style={styles.smallButton} testID={`button-delete-material-${material.id}`}
          >
            <Text style={styles.danger}>Delete</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.separator} />
      {!confirming ? (
        <Pressable accessibilityRole="button" onPress={() => { setTyped(''); setConfirming(true); }} disabled={busy} style={styles.smallButton} testID="button-delete-course">
          <Text style={styles.danger}>Delete course…</Text>
        </Pressable>
      ) : (
        <View style={styles.confirm} testID="panel-confirm-delete-course">
          <Text style={styles.body}>
            This permanently deletes <Text style={styles.bold}>{courseName}</Text> with its materials, study sessions, quiz history,
            review items and lectures. It can’t be undone.
          </Text>
          <Text style={styles.caption}>Type <Text style={styles.bold}>{confirmWord}</Text> to confirm.</Text>
          <TextInput
            value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} placeholder={courseName}
            placeholderTextColor={colors.mutedForeground} accessibilityLabel={`Type ${confirmWord} to confirm`} style={styles.input} testID="input-confirm-course-name"
          />
          <View style={styles.buttons}>
            <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.smallButton} testID="button-cancel-delete-course">
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button" accessibilityState={{ disabled: !matches || busy }} disabled={!matches || busy}
              onPress={() => void onDeleteCourse()} style={[styles.deleteButton, (!matches || busy) && styles.disabled]} testID="button-confirm-delete-course"
            >
              <Text style={styles.deleteText}>Delete course</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { gap: 8, marginTop: 6 },
    title: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
    caption: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
    body: { color: colors.foreground, fontSize: 14, lineHeight: 21 },
    bold: { fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    name: { flex: 1, color: colors.foreground, fontSize: 14 },
    smallButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    danger: { color: colors.destructive, fontSize: 14, fontWeight: '600' },
    cancel: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 6 },
    confirm: { gap: 8 },
    input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 12 },
    buttons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    deleteButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.destructive, justifyContent: 'center' },
    deleteText: { color: colors.destructiveForeground, fontSize: 15, fontWeight: '700' },
    disabled: { opacity: 0.45 },
  });
}
