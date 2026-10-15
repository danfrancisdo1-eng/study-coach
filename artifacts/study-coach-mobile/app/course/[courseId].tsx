import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import {
  deleteCourse, getGetCourseResultsQueryKey, getGetStudyStateQueryKey, getListLecturesQueryKey, getListStudySessionsQueryKey, useGetCourseResults, useGetStudyState, useListLectures, useListStudySessions, useLookupExamGuide, usePutStudyState, useSaveExamFacts,
  getGetPremiumStatusQueryKey, useGetPremiumStatus,
} from '@workspace/api-client-react';
import { goBack } from '@/lib/nav';
import { useColors } from '@/hooks/useColors';
import { friendlyError } from '@/lib/friendly-error';
import { describeExamDate, examDateHint, parseExamDate } from '@/lib/exam-date';
import { courseExamFacts, factsFromInputs, needsFactsLookup, realExamLine, timedChoices, type TimedSize } from '@/lib/exam-facts';
import { whenLabel } from '@/lib/when';
import { ActionButton } from '@/components/ActionButton';
import { CourseManager, type ManagedMaterial } from '@/components/CourseManager';
import { MaterialIntake, type SavedMaterial } from '@/components/MaterialIntake';
import { CourseSkeleton } from '@/components/Skeleton';
import { ALL_TOPICS, NO_MATERIAL_NOTE_KEY, studyRequest, topicChoices, type StudyAction } from '@/lib/course-actions';

/**
 * One course or exam (SPEC §7 course list layer, D-023, D-058): the actions row (add material,
 * add another course, back to the list, delete, practice, simulated exam, flashcards, hooks),
 * the topic history (missed out of answered per topic) and the coach's recommended topics,
 * then the exam guide, progress, memory sheet, materials, lectures and the manager.
 * Practice, exam, flashcards and hooks go through the chat: the course becomes the coach's
 * focus and the request is sent on the student's behalf (`/(tabs)?send=…`).
 */

type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});
// Plain sentences only, never a stack trace (D-065).
const readable = (problem: unknown): string => friendlyError(problem);

export default function CourseScreen() {
  const { courseId, intake } = useLocalSearchParams<{ courseId: string; intake?: string }>();
  // "Add material" right after adding the course (D-057): the screen opens scrolled to the intake card.
  const scrollRef = useRef<ScrollView>(null);
  const intakeY = useRef<number | null>(null);
  const manageY = useRef<number | null>(null);
  const scrolledToIntake = useRef(false);
  const scrollTo = (y: number | null) => { if (y !== null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }); };
  const scrollToIntake = () => {
    if (intake !== '1' || scrolledToIntake.current || intakeY.current === null) return;
    scrolledToIntake.current = true;
    scrollTo(intakeY.current);
  };
  const [picker, setPicker] = useState<StudyAction | null>(null); // "Which topics?" for flashcards and hooks (D-058)
  const [timedPicker, setTimedPicker] = useState(false); // full exam or a block, timed (D-114)
  const [noMaterialNote, setNoMaterialNote] = useState(false); // the one-time note under "Questions without material" (D-060)
  const { isLoaded, isSignedIn, userId } = useAuth();
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const stateKey = [...getGetStudyStateQueryKey(), userId];
  const stateQuery = useGetStudyState({ query: { queryKey: stateKey, enabled: !!userId } });
  const lecturesQuery = useListLectures({ courseId }, { query: { queryKey: [...getListLecturesQueryKey({ courseId }), userId], enabled: !!userId && !!courseId } });
  const sessionsQuery = useListStudySessions({ query: { queryKey: [...getListStudySessionsQueryKey(), userId], enabled: !!userId } });
  // Read-only after a lapse (D-090): everything stays visible; new AI work waits for Premium.
  const premiumQuery = useGetPremiumStatus({ query: { queryKey: getGetPremiumStatusQueryKey(), enabled: !!userId } });
  const readOnly = !!courseId && !!premiumQuery.data?.readOnlyCourseIds.includes(courseId);
  const resultsQuery = useGetCourseResults(courseId ?? '', { query: { queryKey: [...getGetCourseResultsQueryKey(courseId ?? ''), userId], enabled: !!userId && !!courseId } });
  const putState = usePutStudyState();
  const lookupGuide = useLookupExamGuide();
  const saveFacts = useSaveExamFacts();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [factQuestions, setFactQuestions] = useState('');
  const [factMinutes, setFactMinutes] = useState('');
  const [factPassing, setFactPassing] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // A guide saved before the lookup read the exam's numbers is refreshed once, without asking (D-118; Dan: why make the person ask?).
  const autoLookedUp = useRef<string | null>(null);
  const rawCourse = (Array.isArray(record(stateQuery.data?.state).courses) ? (record(stateQuery.data?.state).courses as unknown[]).map(record) : []).find((c) => c.id === courseId);
  useEffect(() => {
    if (!courseId || autoLookedUp.current === courseId || lookupGuide.isPending || !needsFactsLookup(rawCourse)) return;
    autoLookedUp.current = courseId;
    lookupGuide.mutateAsync({ courseId })
      .then(() => queryClient.invalidateQueries({ queryKey: stateKey }))
      .catch(() => {}); // a failed refresh leaves the old guide; the timed sheet still offers typing the numbers
  });

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/" />;

  const state = record(stateQuery.data?.state);
  const courses = Array.isArray(state.courses) ? state.courses.map(record) : [];
  const course = courses.find((c) => c.id === courseId);
  const materials: SavedMaterial[] = (Array.isArray(state.materials) ? state.materials.map(record) : [])
    .filter((m) => m.courseId === courseId && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.text === 'string')
    .map((m) => ({ id: m.id as string, courseId: courseId!, name: m.name as string, text: m.text as string, extractionFormat: m.extractionFormat as SavedMaterial['extractionFormat'] }));
  const isExam = course?.kind === 'exam';
  const busy = saving || putState.isPending || lookupGuide.isPending || saveFacts.isPending;
  const facts = courseExamFacts(course);
  const choices = isExam ? timedChoices(facts) : [];
  const openEditor = () => {
    setName(typeof course?.name === 'string' ? course.name : '');
    setExamDate(typeof course?.examDate === 'string' ? describeExamDate(course.examDate) : '');
    setFactQuestions(facts.questionCount ? String(facts.questionCount) : '');
    setFactMinutes(facts.durationMinutes ? String(facts.durationMinutes) : '');
    setFactPassing(facts.passingScore);
    setEditing(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
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
    const iso = parseExamDate(examDate);
    if (examDate.trim() && !iso) { setError('Try the exam date like Nov 14 or 11/14/2026.'); return; }
    const typed = isExam ? factsFromInputs(factQuestions, factMinutes, factPassing) : null;
    if (typed && 'error' in typed) { setError(typed.error); return; }
    setError(''); setSaving(true);
    try {
      await persist({ courses: courses.map((c) => c.id === courseId ? { ...c, name: trimmed, ...(isExam ? { examDate: iso ?? undefined } : {}) } : c) });
      // Typed exam facts (D-111): only what differs from what the app already uses is saved as a correction.
      if (typed && 'facts' in typed) {
        const t = typed.facts;
        const changed = t.questionCount !== facts.questionCount || t.durationMinutes !== facts.durationMinutes || t.passingScore !== facts.passingScore;
        if (changed) {
          await saveFacts.mutateAsync({ courseId: courseId!, data: t });
          await queryClient.invalidateQueries({ queryKey: stateKey });
        }
      }
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
      goBack();
    } catch (problem) { setError(readable(problem)); } finally { setSaving(false); }
  };

  const lectures = lecturesQuery.data?.lectures ?? [];
  const results = resultsQuery.data;
  const topics = topicChoices(guideSections.map((sec) => String(sec.name ?? '')), (results?.topics ?? []).map((t) => t.topic));

  // Practice, exam, flashcards, hooks (D-058): this course becomes the coach's focus and the chat sends the request.
  // A timed exam (D-114): the chat sends it with timedExam, so the server sizes and times it from the real exam's facts.
  const startTimed = (size: TimedSize, label: string) => {
    setTimedPicker(false);
    if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, courseId!).catch(() => {});
    router.replace({ pathname: '/(tabs)', params: { send: `Timed exam: ${label}`, courseId: courseId!, timed: size } });
  };
  const startWithCoach = (action: StudyAction, topic: string | null) => {
    setPicker(null);
    setTimedPicker(false);
    if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, courseId!).catch(() => {});
    router.replace({ pathname: '/(tabs)', params: { send: studyRequest(action, topic), courseId: courseId! } });
  };
  // The chat on this course, with nothing sent (D-065: opening a course no longer lands in the chat by itself).
  const talkToCoach = () => {
    if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, courseId!).catch(() => {});
    router.replace('/(tabs)');
  };
  const toList = () => { if (router.canGoBack()) router.back(); else router.replace('/course-list'); };
  // Questions without material (D-060): the first tap on this phone shows a small red note and a Proceed; later taps go straight to the coach.
  const questionsWithoutMaterial = async () => {
    if (noMaterialNote) { setNoMaterialNote(false); startWithCoach('practiceNoMaterial', null); return; }
    const seen = await AsyncStorage.getItem(NO_MATERIAL_NOTE_KEY).catch(() => null);
    if (seen === '1') { startWithCoach('practiceNoMaterial', null); return; }
    AsyncStorage.setItem(NO_MATERIAL_NOTE_KEY, '1').catch(() => {});
    setNoMaterialNote(true);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBack()} style={styles.iconButton} testID="button-back"><Feather name="chevron-left" size={24} color={colors.foreground} /></Pressable>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.title}>{typeof course?.name === 'string' ? course.name : 'Course'}</Text>
          <Text style={styles.caption}>{isExam ? `Certification exam${typeof course?.examDate === 'string' ? ` · ${describeExamDate(course.examDate)}` : ''}` : 'Course'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit name and date" onPress={openEditor} style={styles.iconButton} testID="button-edit-course"><Feather name="edit-2" size={20} color={colors.foreground} /></Pressable>
      </View>
      {stateQuery.isLoading ? <CourseSkeleton /> : !course ? (
        <View style={styles.center}><Text style={styles.body}>This course isn’t in your account anymore.</Text></View>
      ) : (
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]} onContentSizeChange={scrollToIntake}>
          {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
          {/* The edit form sits at the top so the pencil visibly does something (Dan: it looked broken when the form opened below the fold). */}
          {editing ? (
            <View style={styles.card}>
              <Text style={styles.kicker}>Name</Text>
              <TextInput value={name} onChangeText={setName} maxLength={120} style={styles.input} accessibilityLabel="Course name" testID="input-course-name" />
              {isExam ? <><Text style={styles.kicker}>Exam date</Text>
                <TextInput value={examDate} onChangeText={setExamDate} placeholder="e.g. Nov 14" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={styles.input} accessibilityLabel="Exam date" testID="input-exam-date" />
                {examDate.trim() ? <Text style={styles.caption} testID="text-exam-date-hint">{examDateHint(examDate)}</Text> : null}
                <Text style={styles.kicker}>Real exam</Text>
                <View style={styles.row}>
                  <TextInput value={factQuestions} onChangeText={setFactQuestions} placeholder="Questions" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" maxLength={3} style={[styles.input, { flex: 1 }]} accessibilityLabel="Number of questions on the real exam" testID="input-exam-questions" />
                  <TextInput value={factMinutes} onChangeText={setFactMinutes} placeholder="Minutes" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" maxLength={3} style={[styles.input, { flex: 1 }]} accessibilityLabel="Time limit of the real exam in minutes" testID="input-exam-minutes" />
                </View>
                <TextInput value={factPassing} onChangeText={setFactPassing} placeholder="Passing score, e.g. 700 out of 1000" placeholderTextColor={colors.mutedForeground} maxLength={60} style={styles.input} accessibilityLabel="Passing score of the real exam" testID="input-exam-passing" />
                <Text style={styles.caption}>From the official exam page. Used to time full exam simulations.</Text></> : null}
              <View style={styles.row}>
                <ActionButton label="Save" icon="check" onPress={() => void saveDetails()} disabled={busy || !name.trim()} testID="button-save-course" />
                <ActionButton label="Cancel" secondary onPress={() => setEditing(false)} testID="button-cancel-edit" />
              </View>
            </View>
          ) : null}

          <View style={styles.card} testID="panel-course-actions">
            {readOnly ? (
              <View style={styles.readOnly} testID="panel-read-only">
                <Text style={[styles.body, { flex: 0 }]}>Read-only on the free plan. Your materials, results and chats are all kept; studying it with the coach needs Premium.</Text>
                <ActionButton label="See Premium" icon="star" onPress={() => router.push({ pathname: '/premium', params: { reason: 'course_read_only' } })} testID="button-read-only-premium" />
              </View>
            ) : null}
            <Text style={styles.kicker}>Actions</Text>
            <View style={styles.actions}>
              <ActionButton label="Add material" icon="plus-circle" onPress={() => scrollTo(intakeY.current)} testID="button-action-material" />
              <ActionButton label="Add another course" icon="plus" secondary onPress={() => router.push({ pathname: '/course-list', params: { add: '1' } })} testID="button-action-add-course" />
              <ActionButton label="Return to course list" icon="list" secondary onPress={toList} testID="button-action-list" />
            </View>
            <Text style={styles.kicker}>Study with the coach</Text>
            <View style={styles.actions}>
              <ActionButton label="Practice questions" icon="edit-3" onPress={() => startWithCoach('practice', null)} testID="button-action-practice" />
              <ActionButton label="Talk to the coach" icon="message-circle" secondary onPress={talkToCoach} testID="button-action-chat" />
              <ActionButton label="Simulated exam" icon="clock" secondary onPress={() => (isExam ? setTimedPicker(true) : startWithCoach('exam', null))} testID="button-action-exam" />
              <ActionButton label="Flashcards" icon="layers" secondary onPress={() => setPicker('flashcards')} testID="button-action-flashcards" />
              <ActionButton label="Memory tricks" icon="zap" secondary onPress={() => setPicker('hooks')} testID="button-action-hooks" />
              <ActionButton label="Outline" icon="list" secondary onPress={() => startWithCoach('outline', null)} testID="button-action-outline" />
              <ActionButton label="Review sheet (PDF)" icon="file-text" secondary onPress={() => router.push({ pathname: '/review/[courseId]', params: { courseId: courseId! } })} testID="button-action-review-sheet" />
              <ActionButton label="Questions without material" icon="help-circle" secondary onPress={() => void questionsWithoutMaterial()} testID="button-action-no-material" />
            </View>
            {noMaterialNote ? (
              <View style={styles.noteRow} testID="note-no-material">
                <Text style={styles.noteText}>Recommended: upload your material first for the best results.</Text>
                <ActionButton label="Proceed" icon="arrow-right" onPress={() => void questionsWithoutMaterial()} testID="button-no-material-proceed" />
              </View>
            ) : null}
            {state.aiConsent !== true ? <Text style={styles.caption}>The coach needs your AI consent first; it asks on the coach screen.</Text> : null}
          </View>

          <View style={styles.card} testID="panel-topic-history">
            <Text style={styles.kicker}>Topics tested · {results?.topics.length ?? 0}</Text>
            {resultsQuery.isLoading ? <ActivityIndicator color={colors.primaryText} /> : null}
            {(results?.topics ?? []).map((t) => (
              <View key={t.topic} style={styles.topicRow} accessible accessibilityLabel={`${t.topic}: missed ${t.missed} of ${t.total}`}>
                <View style={styles.rowBetween}>
                  <Text style={styles.body} numberOfLines={1}>{t.topic}</Text>
                  <Text style={styles.scoreText}>missed {t.missed} of {t.total}</Text>
                </View>
                {/* Review finding 18 (D-076): the bar is the missed share, in the wrong colour, so it reads the same as the words. */}
                <View style={styles.track}><View style={[styles.fill, { backgroundColor: colors.wrong, width: `${t.total ? Math.round((t.missed / t.total) * 100) : 0}%` }]} /></View>
              </View>
            ))}
            {results && !results.topics.length ? <Text style={styles.caption}>Nothing graded yet. Practice questions or a simulated exam will fill this in.</Text> : null}
          </View>

          {results?.weak.length ? (
            <View style={styles.card} testID="panel-coach-recommends">
              <Text style={styles.kicker}>Coach recommends</Text>
              <Text style={styles.caption}>Missed the last time they came up. Tap one for a practice set on it.</Text>
              <View style={styles.chips}>
                {results.weak.map((concept) => (
                  <Pressable key={concept} accessibilityRole="button" onPress={() => startWithCoach('practice', concept)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} testID="button-weak-topic">
                    <Text style={styles.chipText}>{concept}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}


          {isExam ? (
            <View style={styles.card} testID="panel-exam-guide">
              <View style={styles.rowBetween}>
                <Text style={styles.kicker}>Official exam guide</Text>
                <ActionButton label={guide ? 'Refresh' : 'Look up'} icon="refresh-cw" secondary disabled={busy} onPress={() => void refreshGuide()} testID="button-refresh-guide" />
              </View>
              {realExamLine(facts) ? <Text style={styles.body} testID="text-real-exam">{realExamLine(facts)}</Text> : null}
              {!lookupGuide.isPending && guide && (!facts.questionCount || !facts.durationMinutes) ? <Text style={styles.caption} testID="text-exam-facts-missing">The official page didn't give the {!facts.questionCount && !facts.durationMinutes ? 'number of questions or the time limit' : !facts.questionCount ? 'number of questions' : 'time limit'}. Tap the pencil above to type {!facts.questionCount && !facts.durationMinutes ? 'them' : 'it'} in.</Text> : null}
              {lookupGuide.isPending ? <View style={styles.row}><ActivityIndicator color={colors.primaryText} /><Text style={styles.caption}>Searching for the official guide…</Text></View> : null}
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
                <Text style={styles.kicker}>Progress · {graded.length} {graded.length === 1 ? 'set' : 'sets'}</Text>
                {graded.slice(0, 5).map((s) => (
                  <View key={s.id} style={styles.rowBetween}>
                    <Text style={styles.body} numberOfLines={1}>{whenLabel(s.createdAt)} · {s.topic}</Text>
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
            <Text style={styles.kicker}>Memory sheet · {memoryRows.length}</Text>
            {memoryRows.length ? memoryRows.map((row) => (
              <View key={String(row.id)} style={styles.sheetRow}>
                <Text selectable style={styles.sheetTerm}>{String(row.term)}</Text>
                <Text selectable style={styles.sheetTrick}>⚡ {String(row.trick ?? '')}</Text>
                {row.whenYouSee || row.think ? <Text selectable style={styles.caption}>When you see {String(row.whenYouSee ?? '')} → think {String(row.think ?? '')}</Text> : null}
              </View>
            )) : <Text style={styles.caption}>Fills itself from the questions you miss. Ask the coach "Quiz me from my memory sheet" any time.</Text>}
          </View>

          <View style={styles.card} onLayout={(e) => { intakeY.current = e.nativeEvent.layout.y; scrollToIntake(); }} testID="card-add-material">
            <Text style={styles.kicker}>Add material</Text>
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
              <Text style={styles.kicker}>Lectures · {lectures.length}</Text>
              <ActionButton label="Record" icon="mic" secondary onPress={() => router.push({ pathname: '/lectures/[courseId]', params: { courseId: courseId!, courseName: typeof course.name === 'string' ? course.name : '' } })} testID="button-lectures" />
            </View>
            {lectures.slice(0, 5).map((lecture) => (
              <Pressable key={lecture.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: lecture.id } })} style={styles.lectureRow} testID={`row-lecture-${lecture.id}`}>
                <Feather name="mic" size={15} color={colors.mutedForeground} /><Text style={styles.body} numberOfLines={1}>{lecture.title}</Text><Text style={styles.caption}>{lecture.status}</Text>
              </Pressable>
            ))}
            {!lectures.length ? <Text style={styles.caption}>No lectures yet.</Text> : null}
          </View>

          <View style={styles.card} onLayout={(e) => { manageY.current = e.nativeEvent.layout.y; }}>
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

      {/* "Which topics?" for flashcards and hooks (D-058): the exam guide's sections, the topics already tested, or all. */}
      <Modal visible={picker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
        <View style={[styles.screen, { paddingTop: 20 }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}><Text style={styles.title}>{picker === 'hooks' ? 'Memory tricks on which topics?' : 'Flashcards on which topics?'}</Text><Text style={styles.caption}>Pick one, or all of them</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPicker(null)} style={styles.iconButton} testID="button-close-picker"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
            {topics.map((topic) => (
              <Pressable key={topic} accessibilityRole="button" onPress={() => { if (picker) startWithCoach(picker, topic === ALL_TOPICS ? null : topic); }} style={({ pressed }) => [styles.topicChoice, topic === ALL_TOPICS && styles.topicChoiceAll, pressed && styles.pressed]} testID="button-topic-choice">
                <Feather name={topic === ALL_TOPICS ? 'layers' : 'bookmark'} size={16} color={topic === ALL_TOPICS ? colors.primaryForeground : colors.primaryText} />
                <Text style={[styles.topicChoiceText, topic === ALL_TOPICS && styles.topicChoiceAllText]}>{topic}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={timedPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTimedPicker(false)}>
        <View style={[styles.screen, { paddingTop: 20 }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}><Text style={styles.title}>Simulated exam</Text><Text style={styles.caption}>Timed like the real exam. The clock keeps running if you leave the app.</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setTimedPicker(false)} style={styles.iconButton} testID="button-close-timed"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
            {!choices.length ? (
              // No question count or time limit yet (Dan saw an untimed set with no idea why): say so and offer both ways in.
              <View style={styles.card} testID="panel-timed-needs-facts">
                {lookupGuide.isPending
                  ? <View style={styles.row}><ActivityIndicator color={colors.primaryText} /><Text style={styles.body}>Looking up the real exam's number of questions and time limit…</Text></View>
                  : <Text style={styles.body}>{guide && 'questionCount' in guide ? "The official exam page doesn't list the number of questions or the time limit. Type them in from the exam page and the clock is ready." : "To time it like the real exam, the app needs the exam's number of questions and time limit."}</Text>}
                <View style={styles.actions}>
                  <ActionButton label="Look them up" icon="search" disabled={busy} onPress={() => { setTimedPicker(false); void refreshGuide(); }} testID="button-timed-lookup" />
                  <ActionButton label="Type them in" icon="edit-2" secondary onPress={() => { setTimedPicker(false); openEditor(); }} testID="button-timed-type" />
                </View>
              </View>
            ) : null}
            {choices.map((choice) => (
              <Pressable key={choice.size} accessibilityRole="button" accessibilityLabel={`Start timed ${choice.label}`} onPress={() => startTimed(choice.size, choice.label)} style={({ pressed }) => [styles.topicChoice, choice.size === 'full' && styles.topicChoiceAll, pressed && styles.pressed]} testID={`button-timed-${choice.size}`}>
                <Feather name="clock" size={16} color={choice.size === 'full' ? colors.primaryForeground : colors.primaryText} />
                <Text style={[styles.topicChoiceText, choice.size === 'full' && styles.topicChoiceAllText]}>{choice.label}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => startWithCoach('exam', null)} style={({ pressed }) => [styles.topicChoice, pressed && styles.pressed]} testID="button-timed-none">
              <Feather name="edit-3" size={16} color={colors.primaryText} />
              <Text style={styles.topicChoiceText}>No timer: ask the coach for a set</Text>
            </Pressable>
          </ScrollView>
        </View>
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
  readOnly: { gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 6 },
  sheetRow: { gap: 3, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  sheetTerm: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  sheetTrick: { color: colors.hookText, backgroundColor: colors.hookBg, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, fontSize: 13, fontWeight: '600', alignSelf: 'flex-start' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, gap: 12 },
  kicker: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  body: { flex: 1, color: colors.foreground, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.background, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lectureRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorText: { color: colors.destructive, fontSize: 13 },
  scoreText: { color: colors.foreground, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noteRow: { gap: 8 },
  noteText: { color: colors.destructive, fontSize: 12.5, lineHeight: 17 },
  topicRow: { gap: 6 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.secondary, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.chipBorder, backgroundColor: colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.primaryText, fontSize: 13.5, fontWeight: '600' },
  topicChoice: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  topicChoiceAll: { backgroundColor: colors.primary, borderColor: colors.primary },
  topicChoiceText: { flex: 1, color: colors.foreground, fontSize: 16, fontWeight: '600' },
  topicChoiceAllText: { color: colors.primaryForeground },
  pressed: { opacity: 0.8 },
});
