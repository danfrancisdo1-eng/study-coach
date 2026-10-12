import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import {
  getGetHomeChatQueryKey, getGetStudyStateQueryKey, useGetHomeChat, useGetStudyState, useLookupExamGuide, useOpenHomeChat, usePutStudyState, useReportHomeChatMessage, useSendHomeChatMessage,
  type HomeChat, type HomeChatMessage,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { friendlyError } from '@/lib/friendly-error';
import { ActionButton } from '@/components/ActionButton';
import { MaterialIntake, type SavedMaterial } from '@/components/MaterialIntake';
import { defaultIntakeCourse, type IntakeCourse } from '@/lib/intake-course';
import { QuizCard } from '@/components/QuizCard';
import { FlashcardDeck } from '@/components/FlashcardDeck';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { Welcome } from '@/components/Welcome';
import { shouldShowWelcome, welcomeReplayKey, withWelcomeSeen } from '@/lib/welcome';
import { GlassBar } from '@/components/GlassBar';
import { GlowRing } from '@/components/GlowRing';
import { HomeSkeleton } from '@/components/Skeleton';
import { LiveSetCard } from '@/components/LiveSetCard';
import { liveSetAction } from '@/lib/live-set';

const FINISHED_SET_MESSAGE = 'I finished the set.'; // sent for the student after Grade so the coach can respond to the result
const FINISHED_DECK_MESSAGE = 'I finished the flashcards.';

/**
 * Chat-first home (SPEC §7, D-016): the conversation is the app. The coach asks for the
 * course, creates it, and runs sets and decks in the chat. The course list and Add live on
 * their own page (D-036, app/course-list.tsx); here only the "Coach · <course>" line, which
 * opens it, sits between the header and the chat so the chat keeps the screen.
 */

const AI_NOTICE = 'Study Coach sends your messages, your course names, selected course materials and your quiz answers to Anthropic Claude (and OpenAI for lecture transcription) to coach you, generate practice and explain results. AI may make mistakes; review explanations. You can change this choice at any time. Nothing is sent to a family member or other recipient. Press and hold any coach reply to report it.';

// Plain sentences only, never a stack trace (D-065, usability review finding 2). A 409 already refetched the chat, so it says so.
const readableError = (problem: unknown): string => friendlyError(problem);

type StateRecord = Record<string, unknown>;
const record = (value: unknown): StateRecord => (value && typeof value === 'object' ? value as StateRecord : {});

type HomeCourse = IntakeCourse & { kind: 'course' | 'exam'; examDate?: string; guide?: { found: boolean; sections: number } | null };

function coursesFrom(state: unknown): HomeCourse[] {
  const courses = record(state).courses;
  return (Array.isArray(courses) ? courses : []).flatMap((item) => {
    const course = record(item);
    return typeof course.id === 'string' && typeof course.name === 'string'
      ? [{ id: course.id, name: course.name, kind: course.kind === 'exam' ? 'exam' as const : 'course' as const, ...(typeof course.examDate === 'string' ? { examDate: course.examDate } : {}),
          guide: course.examGuide && typeof course.examGuide === 'object' ? { found: record(course.examGuide).found === true, sections: Array.isArray(record(course.examGuide).sections) ? (record(course.examGuide).sections as unknown[]).length : 0 } : null }]
      : [];
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
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<HomeChatMessage>>(null);
  const quizScrollRef = useRef<ScrollView>(null);
  const { height: windowHeight } = useWindowDimensions();
  const [draft, setDraft] = useState('');
  const [draftHeight, setDraftHeight] = useState(44); // measured from the text; the box shrinks back when the draft is cleared
  const [error, setError] = useState('');
  const [intakeCourseId, setIntakeCourseId] = useState<string | null>(null); // non-null while the + sheet is open
  const [focusCourseId, setFocusCourseId] = useState<string | null>(null); // the course/exam the coach assumes (home selector)
  const [gradedSessionId, setGradedSessionId] = useState<string | null>(null); // keeps the score card visible after grading
  const [finishedDeckId, setFinishedDeckId] = useState<string | null>(null); // keeps the deck summary visible after finishing
  const [studyOpen, setStudyOpen] = useState(false); // the full-screen sheet for the active set / deck
  const openedForRef = useRef<string | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [replayWelcome, setReplayWelcome] = useState(false); // "See the welcome again" on the courses page
  // A request handed over by the course screen (D-058: practice, exam, flashcards, hooks), sent once the chat is on that course.
  const { send: handoff, courseId: handoffCourseId } = useLocalSearchParams<{ send?: string; courseId?: string }>();
  const handoffSentRef = useRef<string | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);

  const stateQuery = useGetStudyState({ query: { queryKey: [...getGetStudyStateQueryKey(), userId], enabled: !!userId } });
  // One thread per course (D-038): the chat follows the focused course; no focus = the general thread.
  const chatParams = focusCourseId ? { courseId: focusCourseId } : undefined;
  const chatKey = [...getGetHomeChatQueryKey(chatParams), userId];
  const chatQuery = useGetHomeChat(chatParams, { query: { queryKey: chatKey, enabled: !!userId } });
  const putState = usePutStudyState();
  const send = useSendHomeChatMessage();
  const open = useOpenHomeChat();
  const report = useReportHomeChatMessage();
  const lookupGuide = useLookupExamGuide();
  const [lookingUp, setLookingUp] = useState<string | null>(null); // course id whose exam guide is being fetched
  // After an exam is added, fetch its official guide (sections + weights) once; the row shows progress.
  const fetchGuide = async (courseId: string) => {
    setLookingUp(courseId);
    try {
      await lookupGuide.mutateAsync({ courseId });
      await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
    } catch { /* the row shows "no guide"; the course screen has Refresh */ }
    finally { setLookingUp(null); }
  };

  const consented = stateQuery.data?.state?.aiConsent === true;

  // A new study session starts when the app opens or comes back to the foreground (the
  // server adds the check-in greeting only after a real break, so quick reloads are quiet).
  const openRef = useRef(open.mutateAsync);
  openRef.current = open.mutateAsync;
  useEffect(() => {
    if (!userId || !consented) return;
    const key = chatKey;
    const openSession = () => { openRef.current({ data: chatParams ?? {} }).then((result) => queryClient.setQueryData(key, result)).catch(() => {}); };
    openSession();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') openSession(); });
    return () => sub.remove();
  }, [userId, consented, focusCourseId]);
  // Switching the focus switches the thread: the docked set/deck cards belong to the new thread.
  useEffect(() => { setGradedSessionId(null); setFinishedDeckId(null); setStudyOpen(false); openedForRef.current = null; }, [focusCourseId]);
  const messages = chatQuery.data?.messages ?? [];
  const version = chatQuery.data?.version ?? 0;
  const busy = send.isPending || putState.isPending;
  const courses = coursesFrom(stateQuery.data?.state);
  const intakeCourse = courses.find((course) => course.id === intakeCourseId) ?? null;
  const focusCourse = courses.find((course) => course.id === focusCourseId) ?? null;
  // Remember the selected course per account (the course list page writes the same key, so
  // it is re-read whenever this screen comes back into view); fall back to the most recent one.
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    AsyncStorage.getItem(`study-coach-focus:${userId}`).then((saved) => { setFocusCourseId(saved || null); }).catch(() => {});
    AsyncStorage.getItem(welcomeReplayKey(userId)).then((flag) => { setReplayWelcome(flag === '1'); }).catch(() => {});
  }, [userId]));
  const selectCourse = (id: string | null) => {
    setFocusCourseId(id);
    if (userId) AsyncStorage.setItem(`study-coach-focus:${userId}`, id ?? '').catch(() => {});
  };
  useEffect(() => {
    if (!focusCourseId && courses.length && messages.length) {
      const recent = defaultIntakeCourse(courses, messages);
      if (recent) setFocusCourseId(recent.id);
    }
  }, [courses.length, messages.length]);
  // The course list page (D-036): pick the coach's focus, open a course, add one.
  // The list is the home for a returning account (D-056): when it is underneath, go back to it; otherwise open it.
  const openCourses = () => { if (router.canGoBack()) router.back(); else router.push('/course-list'); };
  const activeQuiz = chatQuery.data?.activeQuiz ?? null;
  const activeDeck = chatQuery.data?.activeDeck ?? null;
  // A practice set lives in the thread as a card under the coach message that started it
  // (D-053); exam sets keep the full-screen sheet with the numbered bubbles (D-037).
  const liveSet = useMemo(() => liveSetAction(messages), [messages]);
  // The set opens over the chat (D-059, Dan: "the question pops and fills the screen leaving the chat in the
  // background"): practice sets show the live card, exam sets the sheet with the bubbles (D-037).
  const quizSessionId = activeQuiz?.sessionId ?? gradedSessionId;
  const quizIsPractice = quizSessionId ? (activeQuiz?.sessionId === quizSessionId ? activeQuiz.kind === 'practice' : liveSet?.sessionId === quizSessionId && liveSet.kind === 'practice') : false;
  const deckSessionId = activeDeck?.sessionId ?? finishedDeckId;
  const activeStudyId = activeDeck?.sessionId ?? activeQuiz?.sessionId ?? null;
  useEffect(() => {
    // A newly started set or deck opens full screen once; reopening later is the resume bar's job.
    if (activeStudyId && openedForRef.current !== activeStudyId) { openedForRef.current = activeStudyId; setStudyOpen(true); }
  }, [activeStudyId]);
  const lastMessage = messages[messages.length - 1];
  const chips = lastMessage?.role === 'assistant' && !activeQuiz && !activeDeck ? (lastMessage.suggestions ?? []) : [];

  // The list is inverted (newest message first in the data, drawn at the bottom), so it
  // opens at the newest message with no scroll arithmetic; scrollToEnd kept landing short.
  // A new message lands at the bottom (offset 0); once its height is known, a reply taller
  // than the viewport is scrolled so its top is in view, so a long reply with chips under it
  // is read from the start (Dan, 2026-10-08). Measured, so it cannot overshoot: scrollToIndex
  // with viewPosition on an inverted list jumped past the reply to the previous message.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  const viewportRef = useRef(0);
  const positionedRef = useRef<string | null>(null);
  const [stripHeight, setStripHeight] = useState(48); // the glass course strip overlaps the top of the chat (D-048)
  useEffect(() => {
    positionedRef.current = null;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [messages.length]);
  const placeNewest = (id: string, height: number) => {
    if (positionedRef.current === id || id !== messages[messages.length - 1]?.id) return;
    positionedRef.current = id;
    const room = viewportRef.current - stripHeight - 24;
    if (room > 0 && height > room) listRef.current?.scrollToOffset({ offset: height - room, animated: true });
  };

  // The course screen's handoff (D-058) goes out once the chat is loaded, consented and on that course. Before the early returns: hooks keep their order.
  const sendTextRef = useRef<(text: string) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!handoff || stateQuery.isLoading || chatQuery.isLoading || stateQuery.error || chatQuery.error || !consented || busy) return;
    if (handoffCourseId && focusCourseId !== handoffCourseId) return;
    const key = `${handoffCourseId ?? ''}|${handoff}`;
    if (handoffSentRef.current === key) return;
    handoffSentRef.current = key;
    router.setParams({ send: undefined, courseId: undefined });
    void sendTextRef.current(handoff);
  });

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/" />;

  const giveConsent = async () => {
    setError('');
    try {
      const previous = stateQuery.data;
      const state: Record<string, unknown> = { aiConsent: true, courses: [], materials: [], ...(previous?.state ?? {}) };
      // The 13+ attestation happened at sign-up (checkbox) or sign-in (SSO line); record when the account first passed it (D-046).
      const ageConfirmedAt = typeof state.ageConfirmedAt === 'string' ? state.ageConfirmedAt : new Date().toISOString();
      const result = await putState.mutateAsync({ data: { state: { ...state, aiConsent: true, ageConfirmedAt }, version: previous?.version ?? 0 } });
      queryClient.setQueryData([...getGetStudyStateQueryKey(), userId], result);
      // An exam added before consent (welcome → Add) could not look up its guide yet; do it now.
      for (const course of coursesFrom(result.state)) if (course.kind === 'exam' && !course.guide) void fetchGuide(course.id);
    } catch (problem) {
      setError(readableError(problem));
    }
  };

  // The welcome (D-047) is dismissed by either choice; the account remembers it (`welcomeSeenAt`),
  // then "Add a course or exam" opens the courses page with the Add sheet already up.
  const dismissWelcome = async (next: 'add' | 'explore') => {
    if (welcomeBusy) return;
    setWelcomeBusy(true);
    setError('');
    try {
      const previous = stateQuery.data;
      if (!(typeof record(previous?.state).welcomeSeenAt === 'string')) {
        const result = await putState.mutateAsync({ data: { state: withWelcomeSeen(previous?.state), version: previous?.version ?? 0 } });
        queryClient.setQueryData([...getGetStudyStateQueryKey(), userId], result);
      }
    } catch (problem) {
      // Not saved (offline, or the state changed on another device): the welcome simply shows again next time.
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
    } finally {
      setWelcomeBusy(false);
    }
    setReplayWelcome(false);
    if (userId) AsyncStorage.removeItem(welcomeReplayKey(userId)).catch(() => {});
    if (next === 'add') router.push({ pathname: '/course-list', params: { add: '1' } });
  };

  // Report a coach reply (D-046): long-press → reason → the server marks the message and logs it for review.
  const reportMessage = (item: HomeChatMessage) => {
    if (item.role !== 'assistant' || item.reported) return;
    const file = async (reason: 'wrong' | 'harmful' | 'other') => {
      try {
        await report.mutateAsync({ data: { messageId: item.id, reason, ...(focusCourseId ? { courseId: focusCourseId } : {}) } });
        await queryClient.invalidateQueries({ queryKey: chatKey });
        Alert.alert('Thanks', 'The reply is flagged for review.');
      } catch (problem) {
        Alert.alert('Could not send the report', readableError(problem));
      }
    };
    Alert.alert('Report this reply', 'What is wrong with it?', [
      { text: 'It is wrong', onPress: () => void file('wrong') },
      { text: 'It is harmful or inappropriate', onPress: () => void file('harmful') },
      { text: 'Something else', onPress: () => void file('other') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const sendText = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !consented) return;
    setError('');
    try {
      const result: HomeChat = await send.mutateAsync({ data: { content, version, ...(focusCourseId ? { courseId: focusCourseId } : {}) } });
      queryClient.setQueryData(chatKey, result);
      if (result.activeQuiz) { setGradedSessionId(null); setFinishedDeckId(null); } // a new set replaces the old cards
      if (result.activeDeck) { setFinishedDeckId(null); setGradedSessionId(null); }
      setDraft('');
      Keyboard.dismiss();
      const last = result.messages[result.messages.length - 1];
      const actions = last?.actions ?? [];
      if (actions.some((a) => a.type === 'create_course' || a.type === 'lookup_exam_guide')) {
        await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
        for (const a of actions) if (a.type === 'create_course' && a.courseKind === 'exam') void fetchGuide(a.courseId);
      }
      const started = actions.find((a) => a.type === 'start_session' && a.sessionId);
      if (started?.sessionId) router.push({ pathname: '/(tabs)/courses', params: { openSession: started.sessionId } });

    } catch (problem) {
      const status = (problem as { status?: number }).status;
      if (status === 409) await queryClient.invalidateQueries({ queryKey: chatKey });
      setError(readableError(problem));
    }
  };

  // The + corner (CLAUDE.md §8): opens the material sheet on the course the coach
  // most recently worked on; with no course yet, the coach asks for one first.
  sendTextRef.current = sendText;
  const sendMessage = () => sendText(draft);

  const openPlus = () => {
    const course = focusCourse ?? defaultIntakeCourse(courses, messages);
    if (!course) {
      Alert.alert('Which course or exam?', 'Add a course or certification exam first, or tell your coach which one you are working on, and it will set it up for you.');
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

  // Links in a coach reply open in the browser (D-045 web-search answers carry their sources).
  const URL_PATTERN = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
  const withLinks = (text: string) => text.split(URL_PATTERN).map((part, i) => URL_PATTERN.test(part) && i % 2 === 1
    ? <Text key={i} style={styles.link} accessibilityRole="link" onPress={() => { Linking.openURL(part).catch(() => {}); }} testID="chat-link">{part}</Text>
    : part);
  // Coach replies: blank line between paragraphs; "1. Label: trick" lines become their own
  // hook chips (same ⚡ style as the question hooks; Dan: tricks ran together as one paragraph).
  const renderCoachText = (content: string) => {
    const blocks = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return (
      <View style={styles.coachBlocks}>
        {blocks.map((line, i) => {
          const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
          if (numbered) {
            const [, n, rest] = numbered;
            const split = /^([^:]{2,40}):\s*(.*)$/.exec(rest!);
            return (
              <View key={i} style={styles.trickCard} testID="chat-trick">
                <Feather name="zap" size={15} color={colors.hookText} />
                <Text style={styles.trickText}>
                  {split ? <><Text style={styles.trickLabel}>{split[1]}: </Text>{split[2]}</> : rest}
                  <Text style={styles.trickNumber}>  {n}</Text>
                </Text>
              </View>
            );
          }
          return <Text key={i} style={styles.body}>{withLinks(line)}</Text>;
        })}
      </View>
    );
  };

  const renderMessage = ({ item }: { item: HomeChatMessage }) => (
    <View onLayout={(e) => placeNewest(item.id, e.nativeEvent.layout.height)}>
    {item.sessionStart ? <View style={styles.sessionDivider}><View style={styles.sessionLine} /><Text style={styles.sessionLabel}>New session</Text><View style={styles.sessionLine} /></View> : null}
    <Pressable onLongPress={item.role === 'assistant' ? () => reportMessage(item) : undefined} delayLongPress={450} accessibilityHint={item.role === 'assistant' ? 'Press and hold to report this reply' : undefined} style={[styles.turn, item.role === 'user' ? styles.userTurn : styles.coachTurn]} testID={`chat-turn-${item.role}`}>
      {item.role === 'assistant' ? renderCoachText(item.content) : <Text style={styles.body}>{item.content}</Text>}
      {item.reported ? <View style={styles.reportedRow} testID="chat-reported"><Feather name="flag" size={12} color={colors.mutedForeground} /><Text style={styles.caption}>Reported for review</Text></View> : null}
      {item.id === lastMessage?.id && chips.length ? (
        <View style={styles.chipRow}>
          {chips.map((chip) => (
            <Pressable key={chip} accessibilityRole="button" disabled={busy} onPress={() => void sendText(chip)} style={[styles.suggestion, busy && styles.disabled]} testID="button-suggestion">
              <Text style={styles.suggestionText}>{chip}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {item.actions?.map((action) => action.type === 'update_memory_sheet' ? (
        <View key={`sheet-${action.courseId}-${action.rows?.[0]?.id ?? ''}`} style={styles.actionChip} testID="card-memory-sheet">
          <Feather name="bookmark" size={14} color={colors.primaryText} />
          <Text style={styles.actionText}>Saved to your memory sheet</Text>
        </View>
      ) : action.type === 'start_quiz' && action.sessionId && action.sessionId === liveSet?.sessionId ? (
        // The latest set: a compact card that opens it over the chat (in progress) or reopens its review (graded).
        <Pressable key={`set-${action.sessionId}`} accessibilityRole="button" onPress={() => { if (activeQuiz?.sessionId !== action.sessionId) setGradedSessionId(action.sessionId!); setStudyOpen(true); }}
          style={({ pressed }) => [styles.setCard, pressed && styles.pressed]} testID="card-set">
          <Feather name="edit-3" size={16} color={colors.primaryText} />
          <View style={styles.setCardCopy}>
            <Text style={styles.setCardTitle}>{action.kind === 'practice' ? 'Practice set' : 'Exam set'} · {action.topic ?? ''}</Text>
            <Text style={styles.caption}>{activeQuiz?.sessionId === action.sessionId ? `${activeQuiz.answered} of ${activeQuiz.total} answered` : `${action.count ?? ''} questions · graded`}</Text>
          </View>
          <Text style={styles.openLinkText}>{activeQuiz?.sessionId === action.sessionId ? 'Open' : 'Review'}</Text>
        </Pressable>
      ) : (
        <View key={`${action.type}-${action.courseId}-${action.sessionId ?? ''}`} style={styles.actionChip}>
          <Feather name={action.type === 'create_course' ? 'plus-circle' : action.type === 'start_quiz' ? 'edit-3' : action.type === 'start_flashcards' ? 'layers' : action.type === 'lookup_exam_guide' || action.type === 'web_search' ? 'search' : 'play-circle'} size={14} color={colors.primaryText} />
          <Text style={styles.actionText}>
            {action.type === 'create_course' ? `Added course: ${action.name ?? ''}`
              : action.type === 'lookup_exam_guide' ? (action.found ? `Found the official exam guide: ${action.sections ?? 0} sections` : 'No official exam guide found')
              : action.type === 'web_search' ? (action.found ? `Searched the web: ${action.query ?? ''}` : `Web search found nothing reliable: ${action.query ?? ''}`)
              : action.type === 'start_quiz' ? `${action.kind === 'practice' ? 'Practice' : 'Exam'} set: ${action.count ?? ''} questions on ${action.topic ?? ''}`
              : action.type === 'start_flashcards' ? `Flashcards: ${action.count ?? ''} cards on ${action.topic ?? ''}`
              : `Started a session: ${action.topic ?? ''}`}
          </Text>
          {action.type === 'start_session' && action.sessionId ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(tabs)/courses', params: { openSession: action.sessionId } })} style={styles.openLink} testID="button-open-session">
              <Text style={styles.openLinkText}>Open</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </Pressable>
    </View>
  );

  const loading = stateQuery.isLoading || chatQuery.isLoading;
  const loadError = stateQuery.error ?? chatQuery.error;
  const showWelcome = !loading && !loadError && shouldShowWelcome(stateQuery.data?.state, replayWelcome);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={17} color={colors.primaryForeground} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.brand}>Study Coach</Text>
          <Text numberOfLines={1} style={styles.headerSub}>Your coach</Text>
        </View>
        {/* Dan: "need a Return to course list button" on the chat. Sign out is not here: it read as "go back" (D-065); it lives in Account. */}
        <Pressable accessibilityLabel="Return to course list" accessibilityRole="button" testID="button-courses" onPress={openCourses} style={styles.iconButton}>
          <Feather name="list" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      {loading ? (
        <HomeSkeleton />
      ) : showWelcome ? (
        <Welcome busy={welcomeBusy} onAddCourse={() => void dismissWelcome('add')} onExplore={() => void dismissWelcome('explore')} />
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
            <View style={styles.consentHeading}><Feather name="shield" size={19} color={colors.primaryText} /><Text style={styles.cardTitle}>Your choice before AI</Text></View>
            <Text style={styles.body}>{AI_NOTICE}</Text>
            {PRIVACY_URL ? <Text style={[styles.body, styles.link]} accessibilityRole="link" onPress={openPrivacy} testID="link-privacy">Read the privacy policy</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void giveConsent()} style={[styles.primaryButton, busy && styles.disabled]} testID="button-ai-consent">
              <Feather name="check" size={16} color={colors.primaryForeground} />
              <Text style={styles.primaryButtonText}>I understand and consent</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : (
        <View style={styles.chatArea}>
        <FlatList
          ref={listRef}
          data={newestFirst}
          inverted={newestFirst.length > 0}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          // Inverted lists flip their padding: the room under the glass strip is paddingBottom when inverted.
          contentContainerStyle={[styles.list, newestFirst.length > 0 ? { paddingBottom: 12 + stripHeight } : { paddingTop: 12 + stripHeight }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onLayout={(e) => { viewportRef.current = e.nativeEvent.layout.height; }}
          ListEmptyComponent={(
            // A fresh thread (D-040, Dan): the course is already chosen, so offer the first moves as
            // chips instead of asking which course. The general thread still asks.
            <View style={[styles.turn, styles.coachTurn]} testID="chat-empty">
              {focusCourse ? (
                <>
                  {/* The long how-to lives on the welcome now (D-047); the first thread message stays to one line. */}
                  <Text style={styles.body}>{focusCourse.name} is set. Add notes or a lecture with +, or ask for a practice set.</Text>
                  <View style={styles.chipRow}>
                    {[
                      { label: 'Add material', hint: 'syllabus, notes, photos, a lecture', onPress: openPlus },
                      { label: 'Practice set', onPress: () => void sendText('Give me a practice set on the main topics') },
                      { label: 'Show the topics', onPress: () => void sendText(`Show me the topics for ${focusCourse.name}`) },
                    ].map((chip) => (
                      <Pressable key={chip.label} accessibilityRole="button" accessibilityHint={chip.hint} disabled={busy} onPress={chip.onPress} style={[styles.suggestion, busy && styles.disabled]} testID="button-start-chip">
                        <Text style={styles.suggestionText}>{chip.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.body}>Hey. Which course or certification exam are we working on?</Text>
                  {!courses.length ? (
                    <View style={styles.chipRow}>
                      <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: '/course-list', params: { add: '1' } })} style={[styles.suggestion, busy && styles.disabled]} testID="button-start-chip">
                        <Text style={styles.suggestionText}>Add a course or exam</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          )}
          ListHeaderComponent={busy ? <View style={styles.busyRow}><ActivityIndicator color={colors.primaryText} size="small" /><Text style={styles.caption}>{send.isPending && /practice|exam|set|quiz|question/i.test(send.variables?.data.content ?? '') ? 'Coach is writing the first questions…' : 'Coach is thinking…'}</Text></View> : null}
          testID="list-home-chat"
        />
        {/* The one frosted panel (D-048): the "Coach · <course>" strip, which the chat scrolls under. */}
        <GlassBar style={styles.focusGlass} onLayout={(e) => setStripHeight(Math.round(e.nativeEvent.layout.height))}>
          <Pressable accessibilityRole="button" accessibilityLabel="Courses and exams" accessibilityHint="Choose which course the coach works on, open a course, or add one" onPress={openCourses} style={({ pressed }) => [styles.focusBar, pressed && styles.pressed]} testID="button-focus-course">
            <Text style={styles.kicker}>Coach</Text>
            <Text numberOfLines={1} style={styles.focusText}>{focusCourse ? focusCourse.name : courses.length ? 'All courses' : 'Add a course or exam'}</Text>
            <Text style={styles.focusCount}>{courses.length ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}` : ''}</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </GlassBar>
        </View>
      )}

      {/* The active question set is docked above the composer, outside the chat scroll, so every
          new question, feedback or score starts at the top of the panel (not at the chat's end). */}
      {consented && !loading && !loadError && activeStudyId && !studyOpen ? (
        <Pressable accessibilityRole="button" onPress={() => setStudyOpen(true)} style={styles.resumeBar} testID="button-resume-study">
          <Feather name={activeDeck ? 'layers' : 'edit-3'} size={16} color={colors.primaryForeground} />
          <Text style={styles.resumeText}>
            {activeDeck ? `Resume flashcards: ${activeDeck.done} of ${activeDeck.total} done` : `Resume set: question ${(activeQuiz?.answered ?? 0) + 1} of ${activeQuiz?.total ?? ''}`}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.primaryForeground} />
        </Pressable>
      ) : null}
      {/* The set or deck over the chat (D-059): a dimmed thread behind, a sheet that fills the screen, Back to chat on top. */}
      <Modal visible={studyOpen && Boolean(quizSessionId || deckSessionId) && Boolean(userId)} transparent animationType="fade" onRequestClose={() => setStudyOpen(false)}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chat" onPress={() => setStudyOpen(false)} style={[styles.overlayBackdrop, { height: insets.top + 28 }]} />
          <View style={[styles.overlaySheet, { paddingBottom: insets.bottom }]}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" accessibilityLabel="Back to chat" onPress={() => setStudyOpen(false)} style={styles.iconButton} testID="button-back-to-chat">
                <Feather name="chevron-down" size={24} color={colors.foreground} />
              </Pressable>
              <View style={styles.headerCopy}>
                <Text style={styles.brand}>{deckSessionId ? 'Flashcards' : quizIsPractice ? 'Practice' : 'Exam'}</Text>
                <Text numberOfLines={1} style={styles.headerSub}>{(activeDeck ?? activeQuiz)?.topic ?? 'Study Coach'}</Text>
              </View>
            </View>
            <ScrollView ref={quizScrollRef} style={styles.studySheet} contentContainerStyle={[styles.quizDockContent, { paddingBottom: 24 }]} keyboardShouldPersistTaps="handled" testID="dock-quiz">
              {deckSessionId ? (
                <FlashcardDeck key={deckSessionId} sessionId={deckSessionId} userId={userId}
                  onStepChange={() => quizScrollRef.current?.scrollTo({ y: 0, animated: false })}
                  onFinished={(finished) => { setFinishedDeckId(finished.id); void sendText(FINISHED_DECK_MESSAGE); }}
                  onError={(problem) => setError(readableError(problem))} />
              ) : quizSessionId && quizIsPractice ? (
                <LiveSetCard key={quizSessionId} sessionId={quizSessionId} userId={userId}
                  // A new question or the score starts at the top; feedback stays where the answer was tapped (Dan: no jump).
                  onStepChange={(step) => { if (step.startsWith('question:') || step === 'score') quizScrollRef.current?.scrollTo({ y: 0, animated: false }); }}
                  onGraded={(graded) => { setGradedSessionId(graded.id); void sendText(FINISHED_SET_MESSAGE); }}
                  onError={(problem) => setError(readableError(problem))} />
              ) : quizSessionId ? (
                <QuizCard key={quizSessionId} sessionId={quizSessionId} userId={userId}
                  onStepChange={() => quizScrollRef.current?.scrollTo({ y: 0, animated: false })}
                  onGraded={(graded) => { setGradedSessionId(graded.id); void sendText(FINISHED_SET_MESSAGE); }}
                  onError={(problem) => setError(readableError(problem))} />
              ) : null}
              {(gradedSessionId && !activeQuiz && !deckSessionId) || (finishedDeckId && !activeDeck) ? (
                <>
                  <Pressable accessibilityRole="button" onPress={() => { setStudyOpen(false); setGradedSessionId(null); setFinishedDeckId(null); }} style={styles.backToChat} testID="button-done-study"><Text style={styles.backToChatText}>Back to chat</Text></Pressable>
                  {/* Dan (D-059): the review ends with a way back to the course list. */}
                  <Pressable accessibilityRole="button" onPress={() => { setStudyOpen(false); setGradedSessionId(null); setFinishedDeckId(null); openCourses(); }} style={styles.toCourses} testID="button-done-courses"><Text style={styles.toCoursesText}>Return to course list</Text></Pressable>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {(consented || showWelcome) && !loading && !loadError ? (
        // During the welcome the composer stays in place but dimmed and inert (Dan: the first tap is the course, not a message into an empty thread).
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }, showWelcome && styles.composerDimmed]} accessibilityElementsHidden={showWelcome} importantForAccessibility={showWelcome ? 'no-hide-descendants' : 'auto'}>
          {error ? <Text style={styles.errorText} testID="status-chat-error">{error}</Text> : null}
          <View style={styles.composerRow}>
            <Pressable accessibilityLabel="Add material or record a lecture" accessibilityRole="button" disabled={showWelcome} onPress={openPlus} style={styles.plusButton} testID="button-materials-plus">
              <Feather name="plus" size={22} color={colors.primaryForeground} />
            </Pressable>
            {/* The gold ring spins only while the coach is writing a reply or a set (D-048). */}
            <GlowRing active={send.isPending} radius={16} style={styles.inputRing}>
            <TextInput
              value={draft} onChangeText={setDraft} placeholder="Message your coach" placeholderTextColor={colors.mutedForeground}
              multiline maxLength={8000} style={[styles.input, { height: draft ? draftHeight : 44 }]} editable={!busy && !showWelcome} accessibilityLabel="Message your coach" testID="input-home-chat"
              onContentSizeChange={(e) => setDraftHeight(Math.min(140, Math.max(44, Math.ceil(e.nativeEvent.contentSize.height) + (Platform.OS === 'ios' ? 22 : 16))))}
              returnKeyType="send" blurOnSubmit submitBehavior="blurAndSubmit" onSubmitEditing={() => void sendMessage()}
            />
            </GlowRing>
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
  // Transcript look (D-043): the coach's turns sit flush left with no tint; yours are bubbles on the right.
  turn: { gap: 7, alignSelf: 'stretch' },
  userTurn: { backgroundColor: colors.secondary, alignSelf: 'flex-end', maxWidth: '88%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 6 },
  coachTurn: { alignSelf: 'stretch', paddingHorizontal: 2, paddingVertical: 4 },
  turnRole: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  coachBlocks: { gap: 8 },
  trickCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 14, backgroundColor: colors.hookBg },
  trickText: { flex: 1, color: colors.hookText, fontSize: 13.5, lineHeight: 19.5 },
  trickLabel: { fontWeight: '700', color: colors.reviewText },
  trickNumber: { color: colors.hookText, fontSize: 11, opacity: 0.7 },
  body: { color: colors.foreground, fontSize: 14.5, lineHeight: 21 },
  link: { color: colors.primaryText, textDecorationLine: 'underline' },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  reportedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  actionText: { flex: 1, color: colors.foreground, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  openLink: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  openLinkText: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8 },
  sessionDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  sessionLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  sessionLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  quizDock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  studySheet: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(8, 12, 24, 0.55)' },
  overlayBackdrop: { width: '100%' },
  overlaySheet: { flex: 1, backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' },
  setCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, minHeight: 56, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  setCardCopy: { flex: 1, minWidth: 0, gap: 2 },
  setCardTitle: { color: colors.foreground, fontSize: 14.5, fontWeight: '700' },
  resumeBar: { marginHorizontal: 14, marginBottom: 6, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.primary },
  resumeText: { flex: 1, color: colors.primaryForeground, fontSize: 15, fontWeight: '700' },
  backToChat: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, marginTop: 4 },
  backToChatText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  toCourses: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  toCoursesText: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  quizDockContent: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 8 },
  hideScore: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  hideScoreText: { color: colors.mutedForeground, fontSize: 13, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  suggestion: { minHeight: 44, maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.chipBorder, backgroundColor: colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  suggestionText: { color: colors.primaryText, fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  composer: { paddingHorizontal: 14, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  composerDimmed: { opacity: 0.35, pointerEvents: 'none' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  plusButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  inputRing: { flex: 1 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, lineHeight: 20, paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 11 : 8 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  consentWrap: { flex: 1, padding: 18, gap: 10 },
  consentCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 20, gap: 12 },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  secondaryButtonText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  errorCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.destructive, padding: 15, borderRadius: 16, gap: 8, marginHorizontal: 18, marginTop: 13 },
  errorTitle: { color: colors.destructive, fontSize: 15, fontWeight: '700' },
  errorText: { color: colors.destructive, fontSize: 13 },
  sheetTitle: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
  kicker: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  courseBlock: { paddingHorizontal: 14, paddingBottom: 6, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  courseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  courseHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, flex: 1 },
  addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  addText: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
  courseRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  courseCopy: { flex: 1, minWidth: 0 },
  courseName: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  chatArea: { flex: 1 },
  focusGlass: { position: 'absolute', top: 0, left: 0, right: 0 },
  focusBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18 },
  focusText: { flex: 1, color: colors.foreground, fontSize: 17, fontWeight: '600' },
  focusCount: { color: colors.mutedForeground, fontSize: 12 },
  segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  segmentTextSelected: { color: colors.primaryForeground },
  pressed: { opacity: 0.8 },
  sheetContent: { paddingHorizontal: 18, paddingTop: 10, gap: 15 },
  chips: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  chipTextSelected: { color: colors.primaryForeground },
  savedRow: { gap: 3, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  savedName: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
});
