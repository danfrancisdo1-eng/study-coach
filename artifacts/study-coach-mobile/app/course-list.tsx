import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import {
  getGetStudyStateQueryKey, getListStudySessionsQueryKey, useGetStudyState, useListStudySessions, useLookupExamGuide, usePutStudyState,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

/**
 * Courses & exams on their own page (D-036): the home screen keeps only the "Coach · <course>"
 * line, which opens this list. Tap a row to make it the coach's focus and go back; the
 * chevron opens the course's own screen; Add creates a course or a certification exam.
 */

type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
const readable = (problem: unknown): string => {
  const data = (problem as { data?: { error?: unknown } }).data;
  if (data && typeof data.error === 'string') return data.error;
  return problem instanceof Error ? problem.message : 'Something went wrong. Please try again.';
};

type Row = { id: string; name: string; kind: 'course' | 'exam'; examDate?: string; materials: number; guide: { found: boolean; sections: number } | null };

function rowsFrom(state: unknown): Row[] {
  const s = record(state);
  const materials = Array.isArray(s.materials) ? s.materials.map(record) : [];
  return (Array.isArray(s.courses) ? s.courses : []).flatMap((item) => {
    const c = record(item);
    if (typeof c.id !== 'string' || typeof c.name !== 'string') return [];
    const guide = c.examGuide && typeof c.examGuide === 'object' ? record(c.examGuide) : null;
    return [{
      id: c.id, name: c.name, kind: c.kind === 'exam' ? 'exam' as const : 'course' as const,
      ...(typeof c.examDate === 'string' ? { examDate: c.examDate } : {}),
      materials: materials.filter((m) => m.courseId === c.id).length,
      guide: guide ? { found: guide.found === true, sections: Array.isArray(guide.sections) ? guide.sections.length : 0 } : null,
    }];
  });
}

export default function CourseListScreen() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const stateKey = [...getGetStudyStateQueryKey(), userId];
  const stateQuery = useGetStudyState({ query: { queryKey: stateKey, enabled: !!userId } });
  const sessionsQuery = useListStudySessions({ query: { queryKey: [...getListStudySessionsQueryKey(), userId], enabled: !!userId } });
  const putState = usePutStudyState();
  const lookupGuide = useLookupExamGuide();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<'course' | 'exam'>('course');
  const [addName, setAddName] = useState('');
  const [addDate, setAddDate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(`study-coach-focus:${userId}`).then((saved) => { if (saved) setFocusId(saved); }).catch(() => {});
  }, [userId]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  const rows = rowsFrom(stateQuery.data?.state);
  const busy = putState.isPending;
  // Last result per course, from the session list (newest first).
  const lastResult = new Map<string, string>();
  for (const summary of sessionsQuery.data?.sessions ?? []) {
    if (lastResult.has(summary.courseId)) continue;
    const score = summary.targetedScore ?? summary.diagnosticScore;
    if (typeof score === 'number') lastResult.set(summary.courseId, `last set ${Math.round(score)}%`);
  }

  const select = (id: string | null) => {
    setFocusId(id);
    if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, id ?? '').catch(() => {});
    router.back();
  };

  // After an exam is added, fetch its official guide once; the row shows progress meanwhile.
  const fetchGuide = async (courseId: string) => {
    setLookingUp(courseId);
    try {
      await lookupGuide.mutateAsync({ courseId });
      await queryClient.invalidateQueries({ queryKey: stateKey });
    } catch { /* the row shows "no guide"; the course screen has Refresh */ }
    finally { setLookingUp(null); }
  };

  const addCourse = async () => {
    const name = addName.trim();
    if (!name || busy) return;
    if (addKind === 'exam' && addDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(addDate.trim())) { setError('Exam date must look like 2026-11-14.'); return; }
    setError('');
    try {
      const previous = stateQuery.data;
      const state = record(previous?.state);
      const course = { id: newId(), name, kind: addKind, ...(addKind === 'exam' && addDate.trim() ? { examDate: addDate.trim() } : {}) };
      const result = await putState.mutateAsync({ data: { state: { aiConsent: true, materials: [], ...state, courses: [...(Array.isArray(state.courses) ? state.courses : []), course] }, version: previous?.version ?? 0 } });
      queryClient.setQueryData(stateKey, result);
      setAddOpen(false); setAddName(''); setAddDate(''); setAddKind('course');
      setFocusId(course.id);
      if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, course.id).catch(() => {});
      if (course.kind === 'exam') void fetchGuide(course.id);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: stateKey });
      setError(readable(problem));
    }
  };

  const detail = (row: Row) => [
    row.kind === 'exam' ? `exam${row.examDate ? ` · ${row.examDate}` : ''}` : 'course',
    `${row.materials} material${row.materials === 1 ? '' : 's'}`,
    ...(lastResult.get(row.id) ? [lastResult.get(row.id)!] : []),
    ...(row.kind === 'exam' ? [lookingUp === row.id ? 'looking up the exam guide…' : row.guide?.found ? `${row.guide.sections} sections` : row.guide ? 'no official guide found' : ''] : []),
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-course-list">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton} testID="button-back"><Feather name="chevron-left" size={24} color={colors.foreground} /></Pressable>
        <View style={styles.headerCopy}><Text style={styles.title}>Courses & exams</Text><Text style={styles.caption}>Tap one to make it the coach's focus</Text></View>
        <Pressable accessibilityRole="button" onPress={() => setAddOpen(true)} style={styles.addButton} testID="button-add-course">
          <Feather name="plus" size={16} color={colors.primary} /><Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>
      {stateQuery.isLoading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
          {error && !addOpen ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: focusId === null }} onPress={() => select(null)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID="row-all-courses">
            <Feather name="layers" size={16} color={focusId === null ? colors.primary : colors.mutedForeground} />
            <View style={styles.rowCopy}><Text style={[styles.rowName, focusId === null && { color: colors.primary }]}>All courses</Text><Text style={styles.caption}>The coach asks which one when it matters</Text></View>
            {focusId === null ? <Feather name="check" size={16} color={colors.primary} /> : null}
          </Pressable>
          {rows.map((row) => (
            <View key={row.id} style={[styles.row, row.id === focusId && styles.rowSelected]} testID={`row-course-${row.id}`}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Coach on ${row.name}`} accessibilityState={{ selected: row.id === focusId }} onPress={() => select(row.id)} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]} testID={`button-focus-${row.id}`}>
                <Feather name={row.kind === 'exam' ? 'award' : 'book'} size={16} color={row.id === focusId ? colors.primary : colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowName, row.id === focusId && { color: colors.primary }]}>{row.name}</Text>
                  <Text numberOfLines={1} style={styles.caption}>{detail(row)}</Text>
                </View>
                {row.id === focusId ? <Feather name="check" size={16} color={colors.primary} /> : null}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${row.name}`} onPress={() => router.push({ pathname: '/course/[courseId]', params: { courseId: row.id } })} style={styles.rowOpen} testID={`button-open-${row.id}`}>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
          {!rows.length ? <Text style={styles.empty}>No courses yet. Add one here, or just tell the coach what you're studying.</Text> : null}
        </ScrollView>
      )}

      <Modal visible={addOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: 20 }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}><Text style={styles.title}>Add a course or exam</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setAddOpen(false)} style={styles.iconButton} testID="button-close-add"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
          </View>
          <View style={styles.sheetContent}>
            <View style={styles.segment}>
              {(['course', 'exam'] as const).map((kind) => (
                <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: addKind === kind }} onPress={() => setAddKind(kind)} style={[styles.segmentItem, addKind === kind && styles.segmentSelected]} testID={`button-kind-${kind}`}>
                  <Text style={[styles.segmentText, addKind === kind && styles.segmentTextSelected]}>{kind === 'course' ? 'College course' : 'Certification exam'}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={addName} onChangeText={setAddName} maxLength={120} placeholder={addKind === 'exam' ? 'e.g. AWS Solutions Architect Associate' : 'e.g. BIOL 114'} placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Name" testID="input-add-name" autoFocus />
            {addKind === 'exam' ? <TextInput value={addDate} onChangeText={setAddDate} placeholder="Exam date, e.g. 2026-11-14 (optional)" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={styles.input} accessibilityLabel="Exam date" testID="input-add-date" /> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy || !addName.trim()} onPress={() => void addCourse()} style={[styles.primaryButton, (busy || !addName.trim()) && styles.disabled]} testID="button-save-add">
              <Text style={styles.primaryButtonText}>{addKind === 'exam' ? 'Add exam' : 'Add course'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  addText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rowSelected: { borderColor: colors.primary },
  rowMain: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 },
  rowOpen: { width: 44, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  empty: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  errorText: { color: colors.destructive, fontSize: 13 },
  sheetContent: { paddingHorizontal: 18, paddingTop: 10, gap: 15 },
  segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  segmentTextSelected: { color: colors.primaryForeground },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
