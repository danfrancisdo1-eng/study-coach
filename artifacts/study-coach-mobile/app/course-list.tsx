import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth, useClerk } from '@clerk/expo';
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
import { friendlyError } from '@/lib/friendly-error';
import { ActionButton } from '@/components/ActionButton';
import { describeExamDate, examDateHint, parseExamDate } from '@/lib/exam-date';
import { BUILD } from '@/constants/build';
import { CourseListSkeleton } from '@/components/Skeleton';

/**
 * Courses & exams on their own page (D-036): the home screen keeps only the "Coach · <course>"
 * line, which opens this list. Tap a row to make it the coach's focus and go back; the
 * chevron opens the course's own screen; Add creates a course or a certification exam.
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
  const { signOut } = useClerk();
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
  const [addKind, setAddKind] = useState<'course' | 'exam'>('course');
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

  // The list is the home for a returning account (D-056): with the coach screen underneath, go back to it; as the root, open it.
  const atRoot = !router.canGoBack();
  const toCoach = () => { if (router.canGoBack()) router.back(); else router.push('/(tabs)'); };
  const lecturesFor = (courseId: string) => (lecturesQuery.data?.lectures ?? []).filter((l) => l.courseId === courseId).length;
  const select = (id: string | null) => {
    setFocusId(id);
    if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, id ?? '').catch(() => {});
    toCoach();
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
    const addIso = addKind === 'exam' ? parseExamDate(addDate) : null;
    if (addKind === 'exam' && addDate.trim() && !addIso) { setError('Try the exam date like Nov 14 or 11/14/2026.'); return; }
    setError('');
    try {
      const previous = stateQuery.data;
      const state = record(previous?.state);
      const course = { id: newId(), name, kind: addKind, ...(addIso ? { examDate: addIso } : {}) };
      // Adding a course never grants AI consent by itself (D-047): the consent card stays the one place that does.
      const result = await putState.mutateAsync({ data: { state: { aiConsent: false, materials: [], ...state, courses: [...(Array.isArray(state.courses) ? state.courses : []), course] }, version: previous?.version ?? 0 } });
      queryClient.setQueryData(stateKey, result);
      setAddName(''); setAddDate(''); setAddKind('course');
      setJustAdded({ id: course.id, name: course.name });
      setFocusId(course.id);
      if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, course.id).catch(() => {});
      // The guide lookup is an AI call: before consent it is refused, so the home screen runs it right after the card.
      if (course.kind === 'exam' && state.aiConsent === true) void fetchGuide(course.id);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: stateKey });
      setError(readable(problem));
    }
  };

  const detail = (row: Row) => [
    row.kind === 'exam' ? `exam${row.examDate ? ` · ${describeExamDate(row.examDate)}` : ''}` : 'course',
    `${row.materials + lecturesFor(row.id)} material${row.materials + lecturesFor(row.id) === 1 ? '' : 's'}`,
    ...(lastResult.get(row.id) ? [lastResult.get(row.id)!] : []),
    ...(row.kind === 'exam' ? [lookingUp === row.id ? 'looking up the exam guide…' : row.guide?.found ? `${row.guide.sections} sections` : row.guide ? 'no official guide found' : ''] : []),
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-course-list">
      <View style={styles.header}>
        {atRoot ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Talk to your coach" onPress={toCoach} style={styles.iconButton} testID="button-coach"><Feather name="message-circle" size={22} color={colors.primaryText} /></Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton} testID="button-back"><Feather name="chevron-left" size={24} color={colors.foreground} /></Pressable>
        )}
        <View style={styles.headerCopy}><Text style={styles.title}>Courses & exams</Text><Text style={styles.caption}>Tap one to open it</Text></View>
        <Pressable accessibilityRole="button" onPress={() => setAddOpen(true)} style={styles.addButton} testID="button-add-course">
          <Feather name="plus" size={16} color={colors.primaryText} /><Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>
      {stateQuery.isLoading ? <CourseListSkeleton /> : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
          {error && !addOpen ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: focusId === null }} onPress={() => select(null)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID="row-all-courses">
            <Feather name="layers" size={16} color={focusId === null ? colors.primaryText : colors.mutedForeground} />
            <View style={styles.rowCopy}><Text style={[styles.rowName, focusId === null && { color: colors.primaryText }]}>All courses</Text><Text style={styles.caption}>Talk to the coach about any of them</Text></View>
            {focusId === null ? <Feather name="check" size={16} color={colors.primaryText} /> : null}
          </Pressable>
          {rows.map((row) => (
            // One tap opens the course (D-065, usability finding 3: the row used to do two things). The course you open becomes the coach's course.
            <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Open ${row.name}`} accessibilityState={{ selected: row.id === focusId }}
              onPress={() => { setFocusId(row.id); if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, row.id).catch(() => {}); router.push({ pathname: '/course/[courseId]', params: { courseId: row.id } }); }}
              style={({ pressed }) => [styles.row, row.id === focusId && styles.rowSelected, pressed && styles.pressed]} testID={`row-course-${row.id}`}>
              <View style={styles.rowMain}>
                <Feather name={row.kind === 'exam' ? 'award' : 'book'} size={16} color={row.id === focusId ? colors.primaryText : colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowName, row.id === focusId && { color: colors.primaryText }]}>{row.name}</Text>
                  <Text numberOfLines={1} style={styles.caption}>{detail(row)}</Text>
                </View>
              </View>
              <View style={styles.rowOpen}><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></View>
            </Pressable>
          ))}
          {!rows.length ? <Text style={styles.empty}>No courses yet. Add one here, or just tell the coach what you're studying.</Text> : null}
          {/* Dan (2026-10-12): a plain way to the coach right after the courses, not only the header icon. */}
          <View style={styles.coachButton}><ActionButton label="Talk to the coach" icon="message-circle" onPress={toCoach} testID="button-talk-to-coach" /></View>
          {/* Sign out stays in view (Dan: "There is no logout button anywhere" once Account was folded, D-079); the rest folds. */}
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={({ pressed }) => [styles.row, styles.rowMain, styles.compactRow, styles.signOutRow, pressed && styles.pressed]} testID="button-sign-out">
            <Feather name="log-out" size={14} color={colors.mutedForeground} />
            <View style={styles.rowCopy}><Text maxFontSizeMultiplier={1} style={styles.compactName}>Sign out</Text><Text maxFontSizeMultiplier={1} numberOfLines={1} style={styles.compactCaption}>The next sign-in starts with the tour</Text></View>
          </Pressable>
          {/* The Account page (D-080): privacy, welcome and tour again, sign out, delete my account. */}
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={({ pressed }) => [styles.row, styles.rowMain, styles.compactRow, pressed && styles.pressed]} testID="button-account">
            <Feather name="user" size={14} color={colors.mutedForeground} />
            <View style={styles.rowCopy}><Text maxFontSizeMultiplier={1} style={styles.compactName}>Account</Text><Text maxFontSizeMultiplier={1} numberOfLines={1} style={styles.compactCaption}>Privacy, the tour again, delete my account · build {BUILD}</Text></View>
            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
          </Pressable>
        </ScrollView>
      )}

      <Modal visible={addOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setAddOpen(false); setJustAdded(null); }}>
        <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: 20 }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}><Text style={styles.title}>{justAdded ? `Added ${justAdded.name}` : 'Add a course or exam'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => { setAddOpen(false); setJustAdded(null); }} style={styles.iconButton} testID="button-close-add"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
          </View>
          {justAdded ? (
            <View style={styles.sheetContent} testID="panel-added-next">
              <Text style={styles.nextTitle}>What next?</Text>
              <Animated.View entering={FadeInUp.delay(80).duration(260)}>
                <Pressable accessibilityRole="button" onPress={() => { const id = justAdded.id; setJustAdded(null); setAddOpen(false); router.push({ pathname: '/course/[courseId]', params: { courseId: id, intake: '1' } }); }} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} testID="button-next-material">
                  <Text style={styles.primaryButtonText}>Add material</Text>
                </Pressable>
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
            <View style={styles.segment}>
              {(['course', 'exam'] as const).map((kind) => (
                <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: addKind === kind }} onPress={() => setAddKind(kind)} style={[styles.segmentItem, addKind === kind && styles.segmentSelected]} testID={`button-kind-${kind}`}>
                  <Text style={[styles.segmentText, addKind === kind && styles.segmentTextSelected]}>{kind === 'course' ? 'College course' : 'Certification exam'}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={addName} onChangeText={setAddName} maxLength={120} placeholder={addKind === 'exam' ? 'e.g. AWS Solutions Architect Associate' : 'e.g. BIOL 114'} placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Name" testID="input-add-name" autoFocus />
            {addKind === 'exam' ? <TextInput value={addDate} onChangeText={setAddDate} placeholder="Exam date, e.g. Nov 14 (optional)" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={styles.input} accessibilityLabel="Exam date" testID="input-add-date" /> : null}
            {addKind === 'exam' && addDate.trim() ? <Text style={styles.caption} testID="text-add-date-hint">{examDateHint(addDate)}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy || !addName.trim()} onPress={() => void addCourse()} style={[styles.primaryButton, (busy || !addName.trim()) && styles.disabled]} testID="button-save-add">
              <Text style={styles.primaryButtonText}>{addKind === 'exam' ? 'Add exam' : 'Add course'}</Text>
            </Pressable>
          </View>
          )}
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
  addText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rowSelected: { borderColor: colors.primary, borderWidth: 2 },
  rowMain: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 },
  rowOpen: { width: 44, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  empty: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  signOutRow: { marginTop: 18 },
  coachButton: { marginTop: 4, marginBottom: 8 },
  sectionTitle: { color: colors.mutedForeground, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 2 },
  // Account rows (Dan: "about half the size and decrease the font, it's distracting"): 36 pt with a 44-pt hit area via the row's own padding.
  compactRow: { minHeight: 34, paddingVertical: 3, gap: 8 },
  compactName: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
  compactCaption: { color: colors.mutedForeground, fontSize: 10.5 },
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
  secondaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 16 },
  secondaryButtonText: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  nextTitle: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
