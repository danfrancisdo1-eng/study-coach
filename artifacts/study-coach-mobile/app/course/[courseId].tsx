import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  deleteCourse, getGetStudyStateQueryKey, getListLecturesQueryKey, getListStudySessionsQueryKey, useGetStudyState, useListLectures, useListStudySessions, useLookupExamGuide, usePutStudyState,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ActionButton } from '@/components/ActionButton';
import { CourseManager, type ManagedMaterial } from '@/components/CourseManager';
import { MaterialIntake, type SavedMaterial } from '@/components/MaterialIntake';

/**
 * One course or exam (SPEC §7 course list layer, D-023): rename, exam date, materials
 * (add / delete), lectures, delete the course. Opened by tapping a row on the home screen.
 */

type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});
const readable = (problem: unknown): string => {
  const data = (problem as { data?: { error?: unknown } }).data;
  if (data && typeof data.error === 'string') return data.error;
  return problem instanceof Error ? problem.message : 'Something went wrong. Please try again.';
};

export default function CourseScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const stateKey = [...getGetStudyStateQueryKey(), userId];
  const stateQuery = useGetStudyState({ query: { queryKey: stateKey, enabled: !!userId } });
  const lecturesQuery = useListLectures({ courseId }, { query: { queryKey: [...getListLecturesQueryKey({ courseId }), userId], enabled: !!userId && !!courseId } });
  const sessionsQuery = useListStudySessions({ query: { queryKey: [...getListStudySessionsQueryKey(), userId], enabled: !!userId } });
  const putState = usePutStudyState();
  const lookupGuide = useLookupExamGuide();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  const state = record(stateQuery.data?.state);
  const courses = Array.isArray(state.courses) ? state.courses.map(record) : [];
  const course = courses.find((c) => c.id === courseId);
  const materials: SavedMaterial[] = (Array.isArray(state.materials) ? state.materials.map(record) : [])
    .filter((m) => m.courseId === courseId && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.text === 'string')
    .map((m) => ({ id: m.id as string, courseId: courseId!, name: m.name as string, text: m.text as string, extractionFormat: m.extractionFormat as SavedMaterial['extractionFormat'] }));
  const isExam = course?.kind === 'exam';
  const busy = saving || putState.isPending || lookupGuide.isPending;
  const guide = isExam && course?.examGuide && typeof course.examGuide === 'object' ? record(course.examGuide) : null;
  const guideSections = Array.isArray(guide?.sections) ? (guide!.sections as unknown[]).map(record) : [];
  const memoryRows = (Array.isArray(state.memorySheet) ? state.memorySheet.map(record) : []).filter((r) => r.courseId === courseId && typeof r.term === 'string');
  const refreshGuide = async () => {
    setError('');
    try {
      await lookupGuide.mutateAsync({ courseId: courseId! });
      await queryClient.invalidateQueries({ queryKey: stateKey });
    } catch (problem) { setError(readable(problem)); }
  };

  const persist = async (next: StateRecord) => {
    const previous = stateQuery.data;
    if (!previous) throw new Error('Your account is still loading. Try again in a moment.');
    const result = await putState.mutateAsync({ data: { state: { ...state, aiConsent: state.aiConsent === true, ...next }, version: previous.version } });
    queryClient.setQueryData(stateKey, result);
  };

  const saveDetails = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (examDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(examDate.trim())) { setError('Exam date must look like 2026-11-14.'); return; }
    setError(''); setSaving(true);
    try {
      await persist({ courses: courses.map((c) => c.id === courseId ? { ...c, name: trimmed, ...(isExam ? { examDate: examDate.trim() || undefined } : {}) } : c) });
      setEditing(false);
    } catch (problem) { setError(readable(problem)); } finally { setSaving(false); }
  };

  const deleteMaterial = async (material: ManagedMaterial) => {
    setError(''); setSaving(true);
    try { await persist({ materials: (Array.isArray(state.materials) ? state.materials : []).filter((m) => record(m).id !== material.id) }); }
    catch (problem) { setError(readable(problem)); } finally { setSaving(false); }
  };

  const removeCourse = async () => {
    setError(''); setSaving(true);
    try {
      const result = await deleteCourse(courseId!);
      queryClient.setQueryData(stateKey, { state: result.state, version: result.version });
      await queryClient.invalidateQueries({ queryKey: getListStudySessionsQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListLecturesQueryKey() });
      router.back();
    } catch (problem) { setError(readable(problem)); } finally { setSaving(false); }
  };

  const lectures = lecturesQuery.data?.lectures ?? [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton} testID="button-back"><Feather name="chevron-left" size={24} color={colors.foreground} /></Pressable>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.title}>{typeof course?.name === 'string' ? course.name : 'Course'}</Text>
          <Text style={styles.caption}>{isExam ? `Certification exam${typeof course?.examDate === 'string' ? ` · ${course.examDate}` : ''}` : 'Course'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit name and date" onPress={() => { setName(typeof course?.name === 'string' ? course.name : ''); setExamDate(typeof course?.examDate === 'string' ? course.examDate : ''); setEditing(true); }} style={styles.iconButton} testID="button-edit-course"><Feather name="edit-2" size={20} color={colors.foreground} /></Pressable>
      </View>
      {stateQuery.isLoading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : !course ? (
        <View style={styles.center}><Text style={styles.body}>This course isn’t in your account anymore.</Text></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
          {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
          {editing ? (
            <View style={styles.card}>
              <Text style={styles.kicker}>NAME</Text>
              <TextInput value={name} onChangeText={setName} maxLength={120} style={styles.input} accessibilityLabel="Course name" testID="input-course-name" />
              {isExam ? <><Text style={styles.kicker}>EXAM DATE (YYYY-MM-DD)</Text>
                <TextInput value={examDate} onChangeText={setExamDate} placeholder="2026-11-14" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={styles.input} accessibilityLabel="Exam date" testID="input-exam-date" /></> : null}
              <View style={styles.row}>
                <ActionButton label="Save" icon="check" onPress={() => void saveDetails()} disabled={busy || !name.trim()} testID="button-save-course" />
                <ActionButton label="Cancel" secondary onPress={() => setEditing(false)} testID="button-cancel-edit" />
              </View>
            </View>
          ) : null}

          {isExam ? (
            <View style={styles.card} testID="panel-exam-guide">
              <View style={styles.rowBetween}>
                <Text style={styles.kicker}>OFFICIAL EXAM GUIDE</Text>
                <ActionButton label={guide ? 'Refresh' : 'Look up'} icon="refresh-cw" secondary disabled={busy} onPress={() => void refreshGuide()} testID="button-refresh-guide" />
              </View>
              {lookupGuide.isPending ? <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={styles.caption}>Searching for the official guide…</Text></View> : null}
              {guide?.found === true ? (
                <>
                  {guideSections.map((s, i) => (
                    <View key={i} style={styles.rowBetween}><Text style={styles.body}>{String(s.name)}</Text><Text style={styles.caption}>{typeof s.weight === 'number' ? `${s.weight}%` : ''}</Text></View>
                  ))}
                  {typeof guide.sourceUrl === 'string' ? <Text selectable style={styles.caption}>Source: {guide.sourceUrl}</Text> : null}
                  {typeof guide.notes === 'string' && guide.notes ? <Text style={styles.caption}>{guide.notes}</Text> : null}
                </>
              ) : guide ? <Text style={styles.caption}>No official guide was found{typeof guide.notes === 'string' && guide.notes ? `: ${guide.notes}` : ''}. The coach uses its own knowledge of the exam.</Text>
                : !lookupGuide.isPending ? <Text style={styles.caption}>Look up the published sections and weights so topics and sets match the real exam.</Text> : null}
            </View>
          ) : null}

          {(() => {
            // Progress (D-042): the last few graded sets and what was missed last time, from the session list.
            const graded = (sessionsQuery.data?.sessions ?? []).filter((s) => s.courseId === courseId && (s.targetedScore ?? s.diagnosticScore) !== null && (s.targetedScore ?? s.diagnosticScore) !== undefined);
            const latest = graded[0];
            return (
              <View style={styles.card} testID="panel-progress">
                <Text style={styles.kicker}>PROGRESS · {graded.length} {graded.length === 1 ? 'SET' : 'SETS'}</Text>
                {graded.slice(0, 5).map((s) => (
                  <View key={s.id} style={styles.rowBetween}>
                    <Text style={styles.body} numberOfLines={1}>{s.createdAt.slice(0, 10)} · {s.topic}</Text>
                    <Text style={styles.scoreText}>{Math.round((s.targetedScore ?? s.diagnosticScore) as number)}%</Text>
                  </View>
                ))}
                {latest?.missedConcepts?.length ? <Text style={styles.caption}>Missed last time: {latest.missedConcepts.slice(0, 6).join(', ')}</Text>
                  : graded.length ? <Text style={styles.caption}>Nothing missed last time.</Text>
                  : <Text style={styles.caption}>No graded set yet. Ask the coach for one, or "How am I doing?" any time.</Text>}
              </View>
            );
          })()}
          <View style={styles.card} testID="panel-memory-sheet">
            <Text style={styles.kicker}>MEMORY SHEET · {memoryRows.length}</Text>
            {memoryRows.length ? memoryRows.map((row) => (
              <View key={String(row.id)} style={styles.sheetRow}>
                <Text selectable style={styles.sheetTerm}>{String(row.term)}</Text>
                <Text selectable style={styles.sheetTrick}>⚡ {String(row.trick ?? '')}</Text>
                {row.whenYouSee || row.think ? <Text selectable style={styles.caption}>When you see {String(row.whenYouSee ?? '')} → think {String(row.think ?? '')}</Text> : null}
              </View>
            )) : <Text style={styles.caption}>Fills itself from the questions you miss. Ask the coach "Quiz me from my memory sheet" any time.</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.kicker}>ADD MATERIAL</Text>
            <MaterialIntake
              key={`${userId ?? ''}:${courseId}`}
              courseId={courseId!}
              aiConsent={state.aiConsent === true}
              busy={busy}
              savedMaterials={materials}
              onSave={async (addition) => { await persist({ materials: [...(Array.isArray(state.materials) ? state.materials : []), addition] }); }}
              onError={(problem) => setError(readable(problem))}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.kicker}>LECTURES · {lectures.length}</Text>
              <ActionButton label="Record" icon="mic" secondary onPress={() => router.push({ pathname: '/lectures/[courseId]', params: { courseId: courseId!, courseName: typeof course.name === 'string' ? course.name : '' } })} testID="button-lectures" />
            </View>
            {lectures.slice(0, 5).map((lecture) => (
              <Pressable key={lecture.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: lecture.id } })} style={styles.lectureRow} testID={`row-lecture-${lecture.id}`}>
                <Feather name="mic" size={15} color={colors.mutedForeground} /><Text style={styles.body} numberOfLines={1}>{lecture.title}</Text><Text style={styles.caption}>{lecture.status}</Text>
              </Pressable>
            ))}
            {!lectures.length ? <Text style={styles.caption}>No lectures yet.</Text> : null}
          </View>

          <View style={styles.card}>
            <CourseManager
              courseName={typeof course.name === 'string' ? course.name : 'this course'}
              materials={materials.map((m) => ({ id: m.id, name: m.name, extractionFormat: m.extractionFormat }))}
              busy={busy}
              onDeleteMaterial={deleteMaterial}
              onDeleteCourse={removeCourse}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  sheetRow: { gap: 3, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  sheetTerm: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  sheetTrick: { color: '#b9d0ff', backgroundColor: '#1f2f4f', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, fontSize: 13, fontWeight: '600', alignSelf: 'flex-start' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 12 },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' },
  body: { flex: 1, color: colors.foreground, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.background, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lectureRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorText: { color: colors.destructive, fontSize: 13 },
  scoreText: { color: colors.foreground, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
