import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import {
  getGetStudyStateQueryKey, getListStudySessionsQueryKey, useGetStudyState, useListStudySessions, useLookupExamGuide, usePutStudyState, getListLecturesQueryKey, useListLectures,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { AuroraBackground } from '@/components/AuroraBackground';
import { PressScale } from '@/components/PressScale';
import { HeaderIconButton, HeaderTextButton, ScreenHeader } from '@/components/ScreenHeader';
import { friendlyError } from '@/lib/friendly-error';
import { premiumCode } from '@/lib/premium-ui';
import { describeExamDate, examDateHint, parseExamDate } from '@/lib/exam-date';
import { CourseListSkeleton } from '@/components/Skeleton';
import { KindChoice } from '@/components/KindChoice';

/**
 * Courses & exams, the Courses tab (D-036, D-164): the home screen's "Studying · <course>"
 * strip opens it too. Tap a row to open the course (it becomes the coach's focus); Add
 * creates a course or a certification exam.
 */

type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
// Plain sentences only, never a stack trace (D-065).
const readable = (problem: unknown): string => friendlyError(problem);

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
  // Recorded lectures are material too (Dan: "I added a recorded lecture and it's not counting").
  const lecturesQuery = useListLectures(undefined, { query: { queryKey: [...getListLecturesQueryKey(), userId], enabled: !!userId } });
  const putState = usePutStudyState();
  const lookupGuide = useLookupExamGuide();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const { add } = useLocalSearchParams<{ add?: string }>(); // the welcome's "Add a course or exam" lands here with the sheet open (D-047)
  const [addOpen, setAddOpen] = useState(add === '1');
  // After a save the sheet turns into "what next?" (D-057): Add material, Add another course, Return to the list.
  const [justAdded, setJustAdded] = useState<{ id: string; name: string } | null>(null);
  const [addKind, setAddKind] = useState<'course' | 'exam' | null>(null); // D-158: no default; the student picks
  const [addName, setAddName] = useState('');
  const [addDate, setAddDate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(`study-coach-focus:${userId}`).then((saved) => { if (saved) setFocusId(saved); }).catch(() => {});
  }, [userId]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/" />;

  const rows = rowsFrom(stateQuery.data?.state);
  const busy = putState.isPending;
  // Last result per course, from the session list (newest first).
  const lastResult = new Map<string, string>();
  for (const summary of sessionsQuery.data?.sessions ?? []) {
    if (lastResult.has(summary.courseId)) continue;
    const score = summary.targetedScore ?? summary.diagnosticScore;
    if (typeof score === 'number') lastResult.set(summary.courseId, `last set ${Math.round(score)}%`);
  }

  const lecturesFor = (courseId: string) => (lecturesQuery.data?.lectures ?? []).filter((l) => l.courseId === courseId).length;

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
    const addIso = addKind === 'exam' ? parseExamDate(addDate) : null;
    if (addKind === 'exam' && addDate.trim() && !addIso) { setError('Try the exam date like Nov 14 or 11/14/2026.'); return; }
    setError('');
    try {
      const previous = stateQuery.data;
      const state = record(previous?.state);
      if (!addKind) return;
      const course = { id: newId(), name, kind: addKind, ...(addIso ? { examDate: addIso } : {}) };
      // Adding a course never grants AI consent by itself (D-047): the consent card stays the one place that does.
      const result = await putState.mutateAsync({ data: { state: { aiConsent: false, materials: [], ...state, courses: [...(Array.isArray(state.courses) ? state.courses : []), course] }, version: previous?.version ?? 0 } });
      queryClient.setQueryData(stateKey, result);
      setAddName(''); setAddDate(''); setAddKind(null);
      setJustAdded({ id: course.id, name: course.name });
      setFocusId(course.id);
      if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, course.id).catch(() => {});
      // The guide lookup is an AI call: before consent it is refused, so the home screen runs it right after the card.
      if (course.kind === 'exam' && state.aiConsent === true) void fetchGuide(course.id);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: stateKey });
      setError(readable(problem));
      // A second course on the free plan (D-090): close the sheet and open the paywall.
      const code = premiumCode(problem);
      if (code) { setAddOpen(false); router.push({ pathname: '/premium', params: { reason: code } }); }
    }
  };

  const detail = (row: Row) => [
    row.kind === 'exam' ? `exam${row.examDate ? ` · ${describeExamDate(row.examDate)}` : ''}` : 'course',
    `${row.materials + lecturesFor(row.id)} material${row.materials + lecturesFor(row.id) === 1 ? '' : 's'}`,
    ...(lastResult.get(row.id) ? [lastResult.get(row.id)!] : []),
    ...(row.kind === 'exam' ? [lookingUp === row.id ? 'looking up the exam guide…' : row.guide?.found ? `${row.guide.sections} sections` : ''] : []),
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-course-list">
      <AuroraBackground />
      {/* A tab (D-164): no back and no coach icon; the tab bar is the way between the three pages. */}
      <ScreenHeader title="Courses & exams" right={<HeaderTextButton icon="plus" label="Add" onPress={() => setAddOpen(true)} testID="button-add-course" />} />
      {stateQuery.isLoading ? <CourseListSkeleton /> : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 30 }]}>
          {error && !addOpen ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
          {rows.map((row) => (
            // One tap opens the course (D-065, usability finding 3: the row used to do two things). The course you open becomes the coach's course.
            <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Open ${row.name}`} accessibilityState={{ selected: row.id === focusId }}
              onPress={() => { setFocusId(row.id); if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, row.id).catch(() => {}); router.push({ pathname: '/course/[courseId]', params: { courseId: row.id } }); }}
              style={({ pressed }) => [styles.row, row.id === focusId && styles.rowSelected, pressed && styles.pressed]} testID={`row-course-${row.id}`}>
              <View style={styles.rowMain}>
                <Feather name={row.kind === 'exam' ? 'award' : 'book'} size={16} color={row.id === focusId ? colors.primaryText : colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowName, row.id === focusId && { color: colors.primaryText }]}>{row.name}</Text>
                  <Text numberOfLines={2} style={styles.caption}>{detail(row)}</Text>
                </View>
              </View>
              <View style={styles.rowOpen}><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></View>
            </Pressable>
          ))}
          {!rows.length ? <Text style={styles.empty}>No courses yet. Add one here, or just tell the coach what you're studying.</Text> : null}
          {/* Sign out and Account used to sit here (D-079, D-080); both live on the Account tab now (D-164). */}
        </ScrollView>
      )}

      <Modal visible={addOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setAddOpen(false); setJustAdded(null); }}>
        <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: 20 }]}>
          <ScreenHeader title={justAdded ? `Added ${justAdded.name}` : 'Add a course or exam'} right={<HeaderIconButton icon="x" label="Close" onPress={() => { setAddOpen(false); setJustAdded(null); }} testID="button-close-add" />} />
          {justAdded ? (
            <View style={styles.sheetContent} testID="panel-added-next">
              <Text style={styles.nextTitle}>What next?</Text>
              <Animated.View entering={FadeInUp.delay(80).duration(260)}>
                <PressScale gradient accessibilityRole="button" onPress={() => { const id = justAdded.id; setJustAdded(null); setAddOpen(false); router.push({ pathname: '/course/[courseId]', params: { courseId: id, intake: '1' } }); }} style={styles.primaryButton} testID="button-next-material">
                  <Text style={styles.primaryButtonText}>Add material</Text>
                </PressScale>
              </Animated.View>
              <Animated.View entering={FadeInUp.delay(260).duration(260)}>
                <Pressable accessibilityRole="button" onPress={() => setJustAdded(null)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} testID="button-next-another">
                  <Text style={styles.secondaryButtonText}>Add another course</Text>
                </Pressable>
              </Animated.View>
              <Animated.View entering={FadeInUp.delay(440).duration(260)}>
                <Pressable accessibilityRole="button" onPress={() => { setJustAdded(null); setAddOpen(false); }} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} testID="button-next-list">
                  <Text style={styles.secondaryButtonText}>Return to course list</Text>
                </Pressable>
              </Animated.View>
            </View>
          ) : (
          <View style={styles.sheetContent}>
            <Text style={styles.caption}>Is this a course or a certification exam?</Text>
            <KindChoice value={addKind} onChange={setAddKind} />
            <TextInput value={addName} onChangeText={setAddName} maxLength={120} placeholder={addKind === 'exam' ? 'e.g. AWS Solutions Architect Associate' : addKind === 'course' ? 'e.g. BIOL 114' : 'Pick one above first'} placeholderTextColor={colors.mutedForeground} editable={addKind !== null} style={[styles.input, addKind === null && styles.disabled]} accessibilityLabel="Name" testID="input-add-name" autoFocus={addKind !== null} />
            {addKind === 'exam' ? <TextInput value={addDate} onChangeText={setAddDate} placeholder="Exam date, e.g. Nov 14 (optional)" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={styles.input} accessibilityLabel="Exam date" testID="input-add-date" /> : null}
            {addKind === 'exam' && addDate.trim() ? <Text style={styles.caption} testID="text-add-date-hint">{examDateHint(addDate)}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <PressScale gradient accessibilityRole="button" disabled={busy || !addName.trim() || !addKind} onPress={() => void addCourse()} style={[styles.primaryButton, (busy || !addName.trim() || !addKind) && styles.disabled]} testID="button-save-add">
              <Text style={styles.primaryButtonText}>{addKind === 'exam' ? 'Add exam' : addKind === 'course' ? 'Add course' : 'Add'}</Text>
            </PressScale>
          </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rowSelected: { borderColor: colors.primary, borderWidth: 2 },
  rowMain: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 },
  rowOpen: { width: 44, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  empty: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  errorText: { color: colors.destructive, fontSize: 13 },
  sheetContent: { paddingHorizontal: 18, paddingTop: 10, gap: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  secondaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 16 },
  secondaryButtonText: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  nextTitle: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
