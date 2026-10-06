import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth, useClerk } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  getGetHomeChatQueryKey, getGetStudyStateQueryKey, useGetHomeChat, useGetStudyState, useOpenHomeChat, usePutStudyState, useSendHomeChatMessage,
  type HomeChat, type HomeChatMessage,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ActionButton } from '@/components/ActionButton';
import { MaterialIntake, type SavedMaterial } from '@/components/MaterialIntake';
import { defaultIntakeCourse, type IntakeCourse } from '@/lib/intake-course';
import { QuizCard } from '@/components/QuizCard';

const FINISHED_SET_MESSAGE = 'I finished the set.'; // sent for the student after Grade so the coach can respond to the result

/**
 * Chat-first home (SPEC §7, D-016): the conversation is the app. The coach asks for the
 * course, creates it, and can open a study session; that session (and all course
 * management) still lives on the Courses tab for now (piece 1 of the build order).
 */

const AI_NOTICE = 'Study Coach sends your messages, your course names, selected course materials and your quiz answers to Anthropic Claude (and OpenAI for lecture transcription) to coach you, generate practice and explain results. AI may make mistakes; review explanations. You can change this choice at any time. Nothing is sent to a family member or other recipient.';

function readableError(problem: unknown): string {
  if (problem && typeof problem === 'object') {
    const data = (problem as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === 'string') return data.error;
    if (typeof (problem as { message?: unknown }).message === 'string') return (problem as { message: string }).message;
  }
  return 'Something went wrong. Please try again.';
}

type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});

function coursesFrom(state: unknown): IntakeCourse[] {
  const courses = record(state).courses;
  return (Array.isArray(courses) ? courses : []).flatMap((item) => {
    const course = record(item);
    return typeof course.id === 'string' && typeof course.name === 'string' ? [{ id: course.id, name: course.name }] : [];
  });
}

function materialsFrom(state: unknown, courseId: string): SavedMaterial[] {
  const materials = record(state).materials;
  return (Array.isArray(materials) ? materials : []).flatMap((item) => {
    const material = record(item);
    return material.courseId === courseId && typeof material.id === 'string' && typeof material.name === 'string' && typeof material.text === 'string'
      ? [{ id: material.id, courseId, name: material.name, text: material.text }] : [];
  });
}

export default function CoachHome() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<HomeChatMessage>>(null);
  const quizScrollRef = useRef<ScrollView>(null);
  const { height: windowHeight } = useWindowDimensions();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [intakeCourseId, setIntakeCourseId] = useState<string | null>(null); // non-null while the + sheet is open
  const [gradedSessionId, setGradedSessionId] = useState<string | null>(null); // keeps the score card visible after grading
  const [intakeBusy, setIntakeBusy] = useState(false);

  const stateQuery = useGetStudyState({ query: { queryKey: [...getGetStudyStateQueryKey(), userId], enabled: !!userId } });
  const chatQuery = useGetHomeChat({ query: { queryKey: [...getGetHomeChatQueryKey(), userId], enabled: !!userId } });
  const putState = usePutStudyState();
  const send = useSendHomeChatMessage();
  const open = useOpenHomeChat();

  const consented = stateQuery.data?.state?.aiConsent === true;

  // A new study session starts when the app opens or comes back to the foreground (the
  // server adds the check-in greeting only after a real break, so quick reloads are quiet).
  const openRef = useRef(open.mutateAsync);
  openRef.current = open.mutateAsync;
  useEffect(() => {
    if (!userId || !consented) return;
    const openSession = () => { openRef.current().then((result) => queryClient.setQueryData([...getGetHomeChatQueryKey(), userId], result)).catch(() => {}); };
    openSession();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') openSession(); });
    return () => sub.remove();
  }, [userId, consented]);
  const messages = chatQuery.data?.messages ?? [];
  const version = chatQuery.data?.version ?? 0;
  const busy = send.isPending || putState.isPending;
  const courses = coursesFrom(stateQuery.data?.state);
  const intakeCourse = courses.find((course) => course.id === intakeCourseId) ?? null;
  const activeQuiz = chatQuery.data?.activeQuiz ?? null;
  const quizSessionId = activeQuiz?.sessionId ?? gradedSessionId;
  const lastMessage = messages[messages.length - 1];
  const chips = lastMessage?.role === 'assistant' && !activeQuiz ? (lastMessage.suggestions ?? []) : [];

  // The list is inverted (newest message first in the data, drawn at the bottom), so it
  // opens at the newest message with no scroll arithmetic; scrollToEnd kept landing short.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  useEffect(() => { listRef.current?.scrollToOffset({ offset: 0, animated: true }); }, [messages.length]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  const giveConsent = async () => {
    setError('');
    try {
      const previous = stateQuery.data;
      const state = { aiConsent: true, courses: [], materials: [], ...(previous?.state ?? {}) };
      const result = await putState.mutateAsync({ data: { state: { ...state, aiConsent: true }, version: previous?.version ?? 0 } });
      queryClient.setQueryData([...getGetStudyStateQueryKey(), userId], result);
    } catch (problem) {
      setError(readableError(problem));
    }
  };

  const sendText = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !consented) return;
    setError('');
    try {
      const result: HomeChat = await send.mutateAsync({ data: { content, version } });
      queryClient.setQueryData([...getGetHomeChatQueryKey(), userId], result);
      if (result.activeQuiz) setGradedSessionId(null); // a new set replaces the old score card
      setDraft('');
      Keyboard.dismiss();
      const last = result.messages[result.messages.length - 1];
      const actions = last?.actions ?? [];
      if (actions.some((a) => a.type === 'create_course')) {
        await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
      }
      const started = actions.find((a) => a.type === 'start_session' && a.sessionId);
      if (started?.sessionId) router.push({ pathname: '/(tabs)/courses', params: { openSession: started.sessionId } });

    } catch (problem) {
      const status = (problem as { status?: number }).status;
      if (status === 409) await queryClient.invalidateQueries({ queryKey: [...getGetHomeChatQueryKey(), userId] });
      setError(readableError(problem));
    }
  };

  // The + corner (CLAUDE.md §8): opens the material sheet on the course the coach
  // most recently worked on; with no course yet, the coach asks for one first.
  const sendMessage = () => sendText(draft);

  const openPlus = () => {
    const course = defaultIntakeCourse(courses, messages);
    if (!course) {
      Alert.alert('Which class?', 'Tell your coach which class you’re taking first, and it will set the course up for you.');
      return;
    }
    setIntakeCourseId(course.id);
  };

  const saveMaterial = async (addition: SavedMaterial) => {
    const previous = stateQuery.data;
    if (!previous) throw new Error('Your account is still loading. Try again in a moment.');
    const state = record(previous.state);
    const materials = Array.isArray(state.materials) ? state.materials : [];
    try {
      const result = await putState.mutateAsync({ data: { state: { ...state, aiConsent: true, materials: [...materials, addition] }, version: previous.version } });
      queryClient.setQueryData([...getGetStudyStateQueryKey(), userId], result);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
      throw problem;
    }
  };

  const renderMessage = ({ item }: { item: HomeChatMessage }) => (
    <View>
    {item.sessionStart ? <View style={styles.sessionDivider}><View style={styles.sessionLine} /><Text style={styles.sessionLabel}>NEW SESSION</Text><View style={styles.sessionLine} /></View> : null}
    <View style={[styles.turn, item.role === 'user' ? styles.userTurn : styles.coachTurn]} testID={`chat-turn-${item.role}`}>
      <Text style={styles.turnRole}>{item.role === 'user' ? 'YOU' : 'COACH'}</Text>
      <Text style={styles.body}>{item.content}</Text>
      {item.id === lastMessage?.id && chips.length ? (
        <View style={styles.chipRow}>
          {chips.map((chip) => (
            <Pressable key={chip} accessibilityRole="button" disabled={busy} onPress={() => void sendText(chip)} style={[styles.suggestion, busy && styles.disabled]} testID="button-suggestion">
              <Text style={styles.suggestionText}>{chip}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {item.actions?.map((action) => (
        <View key={`${action.type}-${action.courseId}-${action.sessionId ?? ''}`} style={styles.actionChip}>
          <Feather name={action.type === 'create_course' ? 'plus-circle' : action.type === 'start_quiz' ? 'edit-3' : 'play-circle'} size={14} color={colors.primary} />
          <Text style={styles.actionText}>
            {action.type === 'create_course' ? `Added course: ${action.name ?? ''}`
              : action.type === 'start_quiz' ? `${action.kind === 'practice' ? 'Practice' : 'Exam'} set: ${action.count ?? ''} questions on ${action.topic ?? ''}`
              : `Started a session: ${action.topic ?? ''}`}
          </Text>
          {action.type === 'start_session' && action.sessionId ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(tabs)/courses', params: { openSession: action.sessionId } })} style={styles.openLink} testID="button-open-session">
              <Text style={styles.openLinkText}>Open</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
    </View>
  );

  const loading = stateQuery.isLoading || chatQuery.isLoading;
  const loadError = stateQuery.error ?? chatQuery.error;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={17} color={colors.primaryForeground} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.brand}>Study Coach</Text>
          <Text numberOfLines={1} style={styles.headerSub}>Your coach</Text>
        </View>
        <Pressable accessibilityLabel="Sign out" accessibilityRole="button" testID="button-sign-out" onPress={() => void signOut()} style={styles.iconButton}>
          <Feather name="log-out" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn’t load your chat</Text>
          <Text style={styles.body}>{readableError(loadError)}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void stateQuery.refetch(); void chatQuery.refetch(); }} style={styles.secondaryButton} testID="button-retry-chat">
            <Text style={styles.secondaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : !consented ? (
        <View style={styles.consentWrap}>
          <View style={styles.consentCard} testID="panel-ai-consent">
            <View style={styles.consentHeading}><Feather name="shield" size={19} color={colors.accentForeground} /><Text style={styles.cardTitle}>Your choice before AI</Text></View>
            <Text style={styles.body}>{AI_NOTICE}</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void giveConsent()} style={[styles.primaryButton, busy && styles.disabled]} testID="button-ai-consent">
              <Feather name="check" size={16} color={colors.primaryForeground} />
              <Text style={styles.primaryButtonText}>I understand and consent</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={newestFirst}
          inverted={newestFirst.length > 0}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <View style={styles.turn}>
              <Text style={styles.turnRole}>COACH</Text>
              <Text style={styles.body}>Hey. What class are we working on? You can also add notes, a syllabus, photos, or record a lecture with the + button.</Text>
            </View>
          )}
          ListHeaderComponent={busy ? <View style={styles.busyRow}><ActivityIndicator color={colors.primary} size="small" /><Text style={styles.caption}>{send.isPending && /practice|exam|set|quiz|question/i.test(send.variables?.data.content ?? '') ? 'Coach is working… writing questions can take up to a minute.' : 'Coach is thinking…'}</Text></View> : null}
          testID="list-home-chat"
        />
      )}

      {/* The active question set is docked above the composer, outside the chat scroll, so every
          new question, feedback or score starts at the top of the panel (not at the chat's end). */}
      {consented && !loading && !loadError && quizSessionId && userId ? (
        <ScrollView ref={quizScrollRef} style={[styles.quizDock, { maxHeight: Math.round(windowHeight * 0.6) }]} contentContainerStyle={styles.quizDockContent} keyboardShouldPersistTaps="handled" testID="dock-quiz">
          <QuizCard key={quizSessionId} sessionId={quizSessionId} userId={userId}
            onStepChange={() => quizScrollRef.current?.scrollTo({ y: 0, animated: false })}
            onGraded={(graded) => { setGradedSessionId(graded.id); void sendText(FINISHED_SET_MESSAGE); }}
            onError={(problem) => setError(readableError(problem))} />
          {gradedSessionId && !activeQuiz ? (
            <Pressable accessibilityRole="button" onPress={() => setGradedSessionId(null)} style={styles.hideScore} testID="button-hide-score"><Text style={styles.hideScoreText}>Hide score card</Text></Pressable>
          ) : null}
        </ScrollView>
      ) : null}
      {consented && !loading && !loadError ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) + 58 }]}>
          {error ? <Text style={styles.errorText} testID="status-chat-error">{error}</Text> : null}
          <View style={styles.composerRow}>
            <Pressable accessibilityLabel="Add material or record a lecture" accessibilityRole="button" onPress={openPlus} style={styles.plusButton} testID="button-materials-plus">
              <Feather name="plus" size={22} color={colors.primaryForeground} />
            </Pressable>
            <TextInput
              value={draft} onChangeText={setDraft} placeholder="Message your coach" placeholderTextColor={colors.mutedForeground}
              multiline maxLength={8000} style={styles.input} editable={!busy} accessibilityLabel="Message your coach" testID="input-home-chat"
              returnKeyType="send" blurOnSubmit submitBehavior="blurAndSubmit" onSubmitEditing={() => void sendMessage()}
            />
            <Pressable accessibilityLabel="Send" accessibilityRole="button" disabled={busy || !draft.trim()} onPress={() => void sendMessage()} style={[styles.sendButton, (busy || !draft.trim()) && styles.disabled]} testID="button-send-home-chat">
              <Feather name="send" size={18} color={colors.primaryForeground} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal visible={intakeCourse !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!intakeBusy) setIntakeCourseId(null); }}>
        {intakeCourse ? (
          <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: 20 }]}>
            <View style={styles.header}>
              <View style={styles.headerCopy}><Text style={styles.sheetTitle}>Add to {intakeCourse.name}</Text><Text style={styles.caption}>Photos, files, a website, or a lecture recording</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" disabled={intakeBusy} onPress={() => setIntakeCourseId(null)} style={styles.iconButton} testID="button-close-intake"><Feather name="x" size={24} color={colors.foreground} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 30 }]}>
              {courses.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {courses.map((course) => (
                    <Pressable key={course.id} accessibilityRole="button" accessibilityState={{ selected: course.id === intakeCourse.id }} disabled={intakeBusy}
                      onPress={() => setIntakeCourseId(course.id)} style={[styles.chip, course.id === intakeCourse.id && styles.chipSelected]} testID={`chip-course-${course.id}`}>
                      <Text style={[styles.chipText, course.id === intakeCourse.id && styles.chipTextSelected]}>{course.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              <MaterialIntake
                key={`${userId ?? ''}:${intakeCourse.id}`}
                courseId={intakeCourse.id}
                aiConsent={consented}
                busy={busy}
                savedMaterials={materialsFrom(stateQuery.data?.state, intakeCourse.id)}
                onSave={saveMaterial}
                onStatusChange={(status) => setIntakeBusy(status.uploading || status.saving)}
                onError={(problem) => setError(readableError(problem))}
                footer={() => (
                  <ActionButton label="Record a lecture" icon="mic" secondary disabled={intakeBusy}
                    onPress={() => { setIntakeCourseId(null); router.push({ pathname: '/lectures/[courseId]', params: { courseId: intakeCourse.id, courseName: intakeCourse.name } }); }}
                    testID="button-record-lecture" />
                )}
              />
              {materialsFrom(stateQuery.data?.state, intakeCourse.id).map((material) => (
                <View key={material.id} style={styles.savedRow}><Text style={styles.savedName}>{material.name}</Text><Text style={styles.caption}>Saved · {material.text.length.toLocaleString()} characters</Text></View>
              ))}
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10 },
  brandMark: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  brand: { color: colors.foreground, fontSize: 16, fontWeight: '700' },
  headerSub: { color: colors.mutedForeground, fontSize: 12 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 18, paddingVertical: 12, gap: 12 },
  turn: { padding: 13, borderRadius: 14, gap: 7, backgroundColor: colors.accent, alignSelf: 'stretch' },
  userTurn: { backgroundColor: colors.secondary, alignSelf: 'flex-end', maxWidth: '92%' },
  coachTurn: { backgroundColor: colors.accent, alignSelf: 'stretch' },
  turnRole: { color: colors.primary, fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  actionText: { flex: 1, color: colors.foreground, fontSize: 13, fontWeight: '600' },
  openLink: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  openLinkText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8 },
  sessionDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  sessionLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  sessionLabel: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  quizDock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  quizDockContent: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 8 },
  hideScore: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  hideScoreText: { color: colors.mutedForeground, fontSize: 13, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  suggestion: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  suggestionText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  composer: { paddingHorizontal: 14, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  plusButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, lineHeight: 20, paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 11 : 8 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  consentWrap: { flex: 1, padding: 18, gap: 10 },
  consentCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 20, gap: 12 },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  secondaryButtonText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  errorCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.destructive, padding: 15, borderRadius: 14, gap: 8, marginHorizontal: 18, marginTop: 13 },
  errorTitle: { color: colors.destructive, fontSize: 15, fontWeight: '700' },
  errorText: { color: colors.destructive, fontSize: 13 },
  sheetTitle: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
  sheetContent: { paddingHorizontal: 18, paddingTop: 10, gap: 15 },
  chips: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  chipTextSelected: { color: colors.primaryForeground },
  savedRow: { gap: 3, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  savedName: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
});
