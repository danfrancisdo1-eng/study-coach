import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ActivityIndicator, Alert, AppState, FlatList, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
import { AuroraBackground } from '@/components/AuroraBackground';
import { PRESS_SCALE, PressScale, withTap } from '@/components/PressScale';
import { HeaderIconButton, ScreenHeader } from '@/components/ScreenHeader';
import { friendlyError } from '@/lib/friendly-error';
import { blocksOf, sectionsOf, type Block, type Span } from '@/lib/coach-text';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { EvaluationPlaceholder, SectionBody, SectionTitle, ThinkingDots } from '@/components/ReportReveal';
import { EVALUATION_TITLE, LESSON_START, revealPlan, shouldStartLesson, visibleChips, type RevealStep } from '@/lib/lesson-chat';
import { closeOpenBold, paceStep, pinnedOffset, streamable } from '@/lib/chat-stream';
import { streamChatMessage } from '@/lib/coach-stream';
import { topicParts } from '@/lib/topic-label';
import { daysLeft, daysLeftLabel } from '@/lib/syllabus';
import { studyRequest } from '@/lib/course-actions';
import { chipParts, hasValues } from '@/lib/chip-label';
import { premiumCode } from '@/lib/premium-ui';
import { ActionButton } from '@/components/ActionButton';
import { MaterialIntake, type SavedMaterial } from '@/components/MaterialIntake';
import { defaultIntakeCourse, type IntakeCourse } from '@/lib/intake-course';
import { QuizCard } from '@/components/QuizCard';
import { FlashcardDeck } from '@/components/FlashcardDeck';
import { PRIVACY_URL, openPrivacy } from '@/lib/privacy-url';
import { Welcome } from '@/components/Welcome';
import { composerPlaceholder, replayOnOpen, shouldShowWelcome, welcomeAsk, welcomeReplayKey, withWelcomeSeen } from '@/lib/welcome';
import { GlassBar } from '@/components/GlassBar';
import { GlowRing } from '@/components/GlowRing';
import { HomeSkeleton } from '@/components/Skeleton';
import { LiveSetCard } from '@/components/LiveSetCard';
import { ProgressBar, useElapsed } from '@/components/ProgressBar';
import { estimate, waitFor } from '@/lib/progress';
import { liveSetAction, resumeLabel, showStudyDone } from '@/lib/live-set';
import { courseExamFacts, type TimedSize } from '@/lib/exam-facts';
import { passMarkLine } from '@/lib/exam-sheet';

const FINISHED_SET_MESSAGE = 'I finished the set.'; // sent for the student after Grade so the coach can respond to the result
const STREAM_TITLE_STEP = { title: 0, line: 420, dots: 0, body: 0 }; // D-206: a title slides in, its line draws; its text streams
const FINISHED_DECK_MESSAGE = 'I finished the flashcards.';
const SIM_EXAM_CHIP = 'Simulated exam'; // D-130: opens the timed sheet, not a chat message
const REVIEW_CHIP = 'Review sheet (PDF)'; // D-139: opens the course's review sheet, not a chat message. The coach sends this exact text (coach.v31), so it stays as is; the course page's button says "Review PDF" (D-180).

/**
 * Chat-first home (SPEC §7, D-016): the conversation is the app. The coach asks for the
 * course, creates it, and runs sets and decks in the chat. The course list and Add live on
 * their own page (D-036, app/course-list.tsx); here only the "Coach · <course>" line, which
 * opens it, sits between the header and the chat so the chat keeps the screen.
 */

// Three short lines instead of one paragraph (review finding 27, D-082); the family-member line is gone with that feature.
const AI_NOTICE: { icon: React.ComponentProps<typeof Feather>['name']; text: string }[] = [
  { icon: 'send', text: 'Your messages, course names, chosen course material and quiz answers go to Anthropic Claude to coach you. Lecture recordings are transcribed by OpenAI.' },
  { icon: 'alert-circle', text: 'AI can make mistakes. Press and hold any coach reply to report it.' },
  { icon: 'refresh-cw', text: 'To withdraw, delete your account in Account (the coach needs AI to work).' },
];

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
  const inputRef = useRef<TextInput>(null); // D-131: tapping a Pop quiz card puts the cursor here
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
  const { send: handoff, courseId: handoffCourseId, timed: handoffTimed } = useLocalSearchParams<{ send?: string; courseId?: string; timed?: string }>();
  const handoffSentRef = useRef<string | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  // D-182: a question typed under the welcome moves it aside for this visit; it waits here while the consent card is answered.
  const [askedFromWelcome, setAskedFromWelcome] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);

  const stateQuery = useGetStudyState({ query: { queryKey: [...getGetStudyStateQueryKey(), userId], enabled: !!userId } });
  // One thread per course (D-038): the chat follows the focused course; no focus = the general thread.
  const chatParams = focusCourseId ? { courseId: focusCourseId } : undefined;
  const chatKey = [...getGetHomeChatQueryKey(chatParams), userId];
  const chatQuery = useGetHomeChat(chatParams, { query: { queryKey: chatKey, enabled: !!userId } });
  const putState = usePutStudyState();
  const send = useSendHomeChatMessage();
  const sendElapsed = useElapsed(send.isPending); // D-126: the estimate while the first questions are written
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
  // D-206: a coach reply streaming in (the report card, going over the misses): typed out at reading pace.
  type LiveReply = { user: string | null; received: string; shown: number; done: HomeChat | null; anchorId: string | null; auto: boolean; draft: string };
  const [live, setLive] = useState<LiveReply | null>(null);
  const userScrolledRef = useRef(false);
  const busy = send.isPending || putState.isPending || live !== null;
  const courses = coursesFrom(stateQuery.data?.state);
  const intakeCourse = courses.find((course) => course.id === intakeCourseId) ?? null;
  const focusCourse = courses.find((course) => course.id === focusCourseId) ?? null;
  // The real exam's pass mark for a timed exam's score (D-115), from the focused course's facts.
  const focusRaw = (Array.isArray((stateQuery.data?.state as { courses?: unknown } | undefined)?.courses) ? (stateQuery.data!.state as { courses: unknown[] }).courses : [])
    .find((c): c is Record<string, unknown> => !!c && typeof c === 'object' && (c as { id?: unknown }).id === focusCourseId);
  const focusPassMark = passMarkLine(courseExamFacts(focusRaw).passingScore);
  // Remember the selected course per account (the course list page writes the same key, so
  // it is re-read whenever this screen comes back into view); fall back to the most recent one.
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    AsyncStorage.getItem(`study-coach-focus:${userId}`).then((saved) => { setFocusCourseId(saved || null); }).catch(() => {});
    AsyncStorage.getItem(welcomeReplayKey(userId)).then((flag) => {
      setReplayWelcome(replayOnOpen(flag, Boolean(handoff)));
      if (flag) AsyncStorage.removeItem(welcomeReplayKey(userId)).catch(() => {});
    }).catch(() => {});
  }, [userId, handoff]));
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
  // The Courses tab (D-036, D-164): pick the coach's focus, open a course, add one.
  const openCourses = () => router.navigate('/course-list');
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
  const baseChips = lastMessage?.role === 'assistant' && !activeQuiz && !activeDeck && !live ? (lastMessage.suggestions ?? []) : [];
  // D-130 (Dan: "No option for exam or simul"): after a graded set on a certification exam, the
  // after-set chips also offer the timed Simulated exam (opens the course's timed sheet).
  // D-203: "Go over my misses" is sent by the app itself; its chip shows only if that failed.
  const [lessonFailedFor, setLessonFailedFor] = useState<string | null>(null);
  const chips = visibleChips(focusCourse?.kind === 'exam' && baseChips.includes('Another set on everything') && !baseChips.includes(SIM_EXAM_CHIP) ? [...baseChips, SIM_EXAM_CHIP] : baseChips, lastMessage?.id, lessonFailedFor);
  // D-203: messages that arrive while the screen is open come in (the report card's sections one after
  // another; other replies fade in); what was already there when the thread loaded is drawn as is.
  const reduceMotion = useReducedMotion();
  const seenRef = useRef<{ thread: string | null; ids: Set<string> } | null>(null);
  if (chatQuery.data && (!seenRef.current || seenRef.current.thread !== (focusCourseId ?? null))) {
    seenRef.current = { thread: focusCourseId ?? null, ids: new Set(chatQuery.data.messages.map((m) => m.id)) };
  }
  const revealsRef = useRef(new Map<string, { at: number; steps: RevealStep[] | null }>());
  const titleShownForRef = useRef<string | null>(null); // the report card whose first title showed while it was written
  /** A new message's reveal, fixed when it first draws; null once it is over (or for older messages). */
  const revealOf = (id: string, titledSections: number): { fresh: boolean; steps: RevealStep[] | null } => {
    if (!seenRef.current || seenRef.current.ids.has(id)) return { fresh: false, steps: null };
    let reveal = revealsRef.current.get(id);
    if (!reveal) {
      reveal = { at: Date.now(), steps: titledSections ? revealPlan(titledSections, titleShownForRef.current === id, reduceMotion) : null };
      revealsRef.current.set(id, reveal);
    }
    const last = reveal.steps?.at(-1);
    const over = Date.now() - reveal.at > (last ? last.body + 600 : 600);
    return { fresh: !over, steps: over ? null : reveal.steps };
  };
  // D-203: the report card asks for the walk through the misses: send it right away, once (the draft stays).
  const lessonTriedRef = useRef<string | null>(null);

  // The list is inverted (newest message first in the data, drawn at the bottom), so it
  // opens at the newest message with no scroll arithmetic; scrollToEnd kept landing short.
  // A new message is placed ONCE, when both are known: that it is the newest, and its height.
  // A reply taller than the viewport is scrolled so its top is in view, so a long reply with
  // chips under it is read from the start (Dan, 2026-10-08); a short one sits at the bottom.
  // D-177 (Dan: memory tricks "keeps you at the bottom of the thread"): before, a scroll-to-bottom
  // on every new message raced the top-of-reply scroll, and whichever ran last won. Measured, so it
  // cannot overshoot: scrollToIndex with viewPosition on an inverted list jumped past the reply.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  const LIVE_REPLY = 'live-reply';
  const LIVE_USER = 'live-user';
  const listData: HomeChatMessage[] = live
    ? [{ id: LIVE_REPLY, role: 'assistant', content: closeOpenBold(live.received.slice(0, live.shown)), at: '' }, ...(live.user ? [{ id: LIVE_USER, role: 'user' as const, content: live.user, at: '' }] : []), ...newestFirst]
    : newestFirst;
  const viewportRef = useRef(0);
  const placedRef = useRef<string | null>(null);
  const heightsRef = useRef(new Map<string, number>());
  const [stripHeight, setStripHeight] = useState(48); // the glass course strip overlaps the top of the chat (D-048)
  const settleNewest = () => {
    const newest = messages[messages.length - 1];
    if (!newest || placedRef.current === newest.id) return;
    const height = heightsRef.current.get(newest.id);
    if (height === undefined) return; // placed once its layout arrives
    placedRef.current = newest.id;
    const room = viewportRef.current - stripHeight - 24;
    listRef.current?.scrollToOffset({ offset: room > 0 && height > room ? height - room : 0, animated: true });
  };
  useEffect(() => { settleNewest(); }, [messages.length]);
  const placeNewest = (id: string, height: number) => {
    heightsRef.current.set(id, height);
    if (id === LIVE_USER) return;
    if (id === LIVE_REPLY) { pinLive(height); return; }
    settleNewest();
  };
  // D-206 (Dan: "it pops you at the end of the chat. So you don't even see the coach's evaluation"): while a
  // reply types out, the top of it (with the student's own line above it, or the report card when the misses
  // start right after it) stays at the top of the screen; the new words land below. A scroll by hand stops it.
  const pinLive = (height: number) => {
    if (!live || userScrolledRef.current) return;
    const room = viewportRef.current - stripHeight - 24;
    const above = live.anchorId ? heightsRef.current.get(live.anchorId) ?? 0 : live.user ? heightsRef.current.get(LIVE_USER) ?? 0 : 0;
    listRef.current?.scrollToOffset({ offset: pinnedOffset(height + (above ? above + 12 : 0), room), animated: false });
  };

  // The course screen's handoff (D-058) goes out once the chat is loaded, consented and on that course. Before the early returns: hooks keep their order.
  const sendTextRef = useRef<(text: string, timed?: TimedSize, auto?: { lessonFor: string }) => Promise<void>>(async () => {});
  const afterReplyRef = useRef<(result: HomeChat, auto?: { lessonFor: string }) => Promise<void>>(async () => {});
  // D-182: a question asked under the welcome before consent goes out as soon as consent is given; the draft stays in the box until it is sent.
  useEffect(() => {
    if (!pendingAsk || !consented || stateQuery.isLoading || chatQuery.isLoading) return;
    const question = pendingAsk;
    setPendingAsk(null);
    void sendTextRef.current(question);
  }, [pendingAsk, consented, stateQuery.isLoading, chatQuery.isLoading]);
  useEffect(() => {
    if (!handoff || stateQuery.isLoading || chatQuery.isLoading || stateQuery.error || chatQuery.error || !consented || busy) return;
    if (handoffCourseId && focusCourseId !== handoffCourseId) return;
    const key = `${handoffCourseId ?? ''}|${handoff}`;
    if (handoffSentRef.current === key) return;
    handoffSentRef.current = key;
    router.setParams({ send: undefined, courseId: undefined, timed: undefined });
    // A timed exam from the course screen (D-114): the server sizes and times it.
    const timed = (['full', '10', '20', '40'] as const).find((size) => size === handoffTimed);
    void sendTextRef.current(handoff, timed);
  });

  // D-206: the pacer: the next word (or a whole "### " title) after its delay, at 400 words a minute; it
  // waits while the set's sheet covers the chat, so the report card types out once the student is back.
  useEffect(() => {
    if (!live || studyOpen) return;
    const step = paceStep(live.received, live.shown, live.done !== null);
    if (step) {
      const timer = setTimeout(() => setLive((l) => (l ? { ...l, shown: Math.max(l.shown, step.shown) } : l)), step.delay);
      return () => clearTimeout(timer);
    }
    if (!live.done || live.shown < live.received.length) return;
    // All shown: the saved chat takes the live reply's place, drawn as is (no second reveal, no scroll).
    const result = live.done;
    const auto = live.auto ? { lessonFor: live.anchorId ?? '' } : undefined;
    if (seenRef.current) for (const m of result.messages) seenRef.current.ids.add(m.id);
    placedRef.current = result.messages[result.messages.length - 1]?.id ?? null;
    queryClient.setQueryData(chatKey, result);
    setLive(null);
    void afterReplyRef.current(result, auto);
  }, [live, studyOpen]);

  useEffect(() => {
    if (busy || !consented || !shouldStartLesson(lastMessage, lessonTriedRef.current)) return;
    lessonTriedRef.current = lastMessage!.id;
    void sendTextRef.current(LESSON_START, undefined, { lessonFor: lastMessage!.id });
  }, [lastMessage?.id, busy, consented]);

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
  const dismissWelcome = async (next: 'add' | 'ask') => {
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
    if (item.role !== 'assistant' || item.reported || item.id === LIVE_REPLY) return;
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

  /** What follows a saved reply, streamed or not: the set/deck cards, the draft, a new course's guide. */
  const afterReply = async (result: HomeChat, auto?: { lessonFor: string }) => {
    if (result.activeQuiz) { setGradedSessionId(null); setFinishedDeckId(null); } // a new set replaces the old cards
    if (result.activeDeck) { setFinishedDeckId(null); setGradedSessionId(null); }
    // An app-sent message (D-203) leaves whatever the student is typing alone.
    if (!auto) { setDraft(''); Keyboard.dismiss(); }
    const last = result.messages[result.messages.length - 1];
    const actions = last?.actions ?? [];
    if (actions.some((a) => a.type === 'create_course' || a.type === 'lookup_exam_guide')) {
      await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
      for (const a of actions) if (a.type === 'create_course' && a.courseKind === 'exam') void fetchGuide(a.courseId);
    }
    const started = actions.find((a) => a.type === 'start_session' && a.sessionId);
    if (started?.sessionId) router.push({ pathname: '/(tabs)/courses', params: { openSession: started.sessionId } });
  };

  const sendText = async (text: string, timed?: TimedSize, auto?: { lessonFor: string }) => {
    const content = text.trim();
    if (!content || busy || !consented) return;
    setError('');
    const data = { content, version, utcOffsetMinutes: -new Date().getTimezoneOffset(), ...(focusCourseId ? { courseId: focusCourseId } : {}), ...(timed ? { timedExam: { size: timed } } : {}) };
    try {
      if (!timed && streamable(content, lastMessage)) {
        // D-206: the reply types out while it is written; it is saved into the thread once it has all shown.
        userScrolledRef.current = false;
        const sentDraft = draft;
        if (!auto) { setDraft(''); Keyboard.dismiss(); }
        setLive({ user: content === LESSON_START ? null : content, received: '', shown: 0, done: null, anchorId: content === LESSON_START ? lastMessage?.id ?? null : null, auto: !!auto, draft: auto ? '' : sentDraft });
        try {
          const result = await streamChatMessage(data, (piece) => setLive((l) => (l ? { ...l, received: l.received + piece } : l)));
          setLive((l) => (l ? { ...l, done: result } : l));
          return;
        } catch (problem) {
          setLive(null);
          if (!auto) setDraft(sentDraft); // never lose what the student typed
          // A server without the streamed route yet (an older deploy): send it the usual way.
          if ((problem as { status?: number }).status !== 404) throw problem;
        }
      }
      const result: HomeChat = await send.mutateAsync({ data });
      // D-203: the report card's first title was already on screen while it was written; it does not slide in twice.
      if (content === FINISHED_SET_MESSAGE) titleShownForRef.current = result.messages[result.messages.length - 1]?.id ?? null;
      queryClient.setQueryData(chatKey, result);
      await afterReply(result, auto);
    } catch (problem) {
      const status = (problem as { status?: number }).status;
      if (status === 409) await queryClient.invalidateQueries({ queryKey: chatKey });
      setError(readableError(problem));
      if (auto) setLessonFailedFor(auto.lessonFor); // the "Go over my misses" chip appears to tap
      // The plan stopped it (D-090): the sentence stays under the chat, the draft stays in the box, the paywall opens.
      const code = premiumCode(problem);
      if (code) router.push({ pathname: '/premium', params: { reason: code, ...(focusCourseId ? { courseId: focusCourseId } : {}) } });
    }
  };

  // The + corner (CLAUDE.md §8): opens the material sheet on the course the coach
  // most recently worked on; with no course yet, the Add sheet.
  sendTextRef.current = sendText;
  afterReplyRef.current = afterReply;
  // D-182: from under the welcome, the first question moves the welcome aside; without consent it waits for the consent card.
  const askFromWelcome = () => {
    const decision = welcomeAsk(draft, consented);
    if (decision === 'nothing') return;
    setAskedFromWelcome(true);
    if (decision === 'send') { void dismissWelcome('ask'); void sendText(draft); return; }
    // Consent first: no welcome-seen save here, so it cannot race the consent save on the same state version.
    setReplayWelcome(false);
    if (userId) AsyncStorage.removeItem(welcomeReplayKey(userId)).catch(() => {});
    setPendingAsk(draft);
    Keyboard.dismiss();
  };
  const sendMessage = () => (showWelcome ? askFromWelcome() : sendText(draft));

  const openPlus = () => {
    const course = focusCourse ?? defaultIntakeCourse(courses, messages);
    // Usability finding 9 (D-073): with no course, + opens the Add sheet instead of an alert; with courses but none picked, the list.
    if (!course) { router.push(courses.length ? '/course-list' : '/course-list?add=1'); return; }
    setIntakeCourseId(course.id);
  };

  const saveMaterial = async (additions: SavedMaterial[]) => {
    const previous = stateQuery.data;
    if (!previous) throw new Error('Your account is still loading. Try again in a moment.');
    const state = record(previous.state);
    const materials = Array.isArray(state.materials) ? state.materials : [];
    try {
      const result = await putState.mutateAsync({ data: { state: { ...state, aiConsent: true, materials: [...materials, ...additions] }, version: previous.version } });
      queryClient.setQueryData([...getGetStudyStateQueryKey(), userId], result);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) await queryClient.invalidateQueries({ queryKey: [...getGetStudyStateQueryKey(), userId] });
      throw problem;
    }
  };

  // Links in a coach reply open in the browser (D-045 web-search answers carry their sources).
  const URL_PATTERN = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
  const withLinks = (text: string) => text.split(URL_PATTERN).map((part, i) => URL_PATTERN.test(part) && i % 2 === 1
    ? <Text key={i} style={styles.link} accessibilityRole="link" onPress={withTap(() => { Linking.openURL(part).catch(() => {}); })} testID="chat-link">{part}</Text>
    : part);
  // Coach replies: blank line between paragraphs; "1. Label: trick" lines become their own
  // hook chips (same ⚡ style as the question hooks; Dan: tricks ran together as one paragraph).
  const renderCoachText = (content: string, messageId?: string, streaming = false) => {
    // D-098: headings bold with room above them, bullets, inline **bold** (lib/coach-text.ts).
    const inline = (spans: Span[]) => spans.map((sp, k) => sp.bold
      ? <Text key={k} style={styles.bold}>{withLinks(sp.text)}</Text>
      : <React.Fragment key={k}>{withLinks(sp.text)}</React.Fragment>);
    const renderBlock = (block: Block, i: number) => {
          if (block.kind === 'heading') return <Text key={i} style={[styles.heading, i > 0 && styles.headingGap]} accessibilityRole="header">{block.spans[0]?.text}</Text>;
          if (block.kind === 'bullet') return (
            <View key={i} style={styles.bulletRow}><Text style={styles.body}>•</Text><Text style={[styles.body, styles.bulletText]}>{inline(block.spans)}</Text></View>
          );
          if (block.kind === 'popquiz') return (
            // D-131: the check question as its own card, so the eye stops on it (Dan: "my eyes would read past it").
            <PressScale key={i} accessibilityRole="button" accessibilityLabel={`Pop Quiz: ${block.spans.map((s) => s.text).join('')}. Double tap to answer.`}
              onPress={() => inputRef.current?.focus()} style={styles.popQuiz} testID="chat-pop-quiz">
              <View style={styles.popQuizHead}><Feather name="help-circle" size={16} color={colors.navyText} /><Text style={styles.popQuizTitle}>Pop Quiz</Text></View>
              <Text style={styles.popQuizText}>{inline(block.spans)}</Text>
              <Text style={styles.popQuizHint}>Type your answer below.</Text>
            </PressScale>
          );
          if (block.kind === 'quote') return (
            // D-130: the one takeaway to remember, set apart (Dan's examples). D-203 (Dan: "why is that bold?"): only its **bold** words are bold.
            <View key={i} style={styles.quoteRow} testID="chat-takeaway"><Text style={styles.body}>{inline(block.spans)}</Text></View>
          );
          if (block.kind === 'trick') return (
            <View key={i} style={styles.trickCard} testID="chat-trick">
              <Feather name="zap" size={15} color={colors.hookText} />
              <Text style={styles.trickText}>
                {block.label ? <Text style={styles.trickLabel}>{block.label}: </Text> : null}{inline(block.spans)}
                <Text style={styles.trickNumber}>  {block.n}</Text>
              </Text>
            </View>
          );
          return <Text key={i} style={styles.body}>{inline(block.spans)}</Text>;
    };
    // D-193 (Dan: "you can't tell where the readiness starts and ends ... each tip should be one
    // concrete thought"): "### " sections get a divider and a coloured title; each "#### " tip is its own card.
    const sections = sectionsOf(blocksOf(content));
    // D-203: a new report card comes in section by section (title slides in, a line draws, dots, then the text).
    const titled = sections.filter((section) => section.title);
    const steps = messageId ? revealOf(messageId, titled.length).steps : null;
    // D-206: while a reply types out, each title slides in as it arrives and its text follows word by word.
    const stepOf = (section: (typeof sections)[number]) => (streaming && section.title ? STREAM_TITLE_STEP : steps && section.title ? steps[titled.indexOf(section)] ?? null : null);
    return (
      <View style={styles.coachBlocks}>
        {sections.map((section, s) => (
          <View key={s} style={[styles.coachSection, section.title && s > 0 && styles.coachSectionRule]} testID={section.title ? 'chat-section' : undefined}>
            {section.title ? <SectionTitle title={section.title.map((t) => t.text).join('')} step={stepOf(section)} textStyle={styles.sectionTitle} /> : null}
            <SectionBody step={stepOf(section)}>
              <View style={styles.coachSection}>
                {section.items.map((item, i) => item.kind === 'tip' ? (
                  <View key={i} style={styles.tipCard} testID="chat-tip">
                    <Text style={styles.tipTitle} accessibilityRole="header">{item.tip.title.map((t) => t.text).join('')}</Text>
                    {item.tip.blocks.map((b, k) => renderBlock(b, k))}
                  </View>
                ) : item.block.spaced ? <View key={i} style={styles.thoughtGap}>{renderBlock(item.block, i)}</View> : renderBlock(item.block, i))}
              </View>
            </SectionBody>
          </View>
        ))}
      </View>
    );
  };

  // D-203: the number of titled sections ("### ") in a coach reply, so its reveal is planned once with the right count.
  const titledCount = (item: HomeChatMessage) => (item.role === 'assistant' ? sectionsOf(blocksOf(item.content)).filter((section) => section.title).length : 0);
  const renderMessage = ({ item }: { item: HomeChatMessage }) => (
    // D-203: a new reply without sections fades in (a report card's sections come in on their own).
    <Animated.View entering={titledCount(item) === 0 && revealOf(item.id, 0).fresh ? FadeIn.duration(reduceMotion ? 150 : 320) : undefined} onLayout={(e) => placeNewest(item.id, e.nativeEvent.layout.height)}>
    {item.sessionStart ? <View style={styles.sessionDivider}><View style={styles.sessionLine} /><Text style={styles.sessionLabel}>New session</Text><View style={styles.sessionLine} /></View> : null}
    <Pressable onLongPress={item.role === 'assistant' ? () => reportMessage(item) : undefined} delayLongPress={450} accessibilityHint={item.role === 'assistant' ? 'Press and hold to report this reply' : undefined} style={[styles.turn, item.role === 'user' ? styles.userTurn : styles.coachTurn]} testID={`chat-turn-${item.role}`}>
      {item.id === LIVE_REPLY ? (item.content ? renderCoachText(item.content, undefined, true) : <ThinkingDots testID="live-thinking" />)
        : item.role === 'assistant' ? renderCoachText(item.content, item.id) : <Text style={styles.body}>{item.content}</Text>}
      {item.reported ? <View style={styles.reportedRow} testID="chat-reported"><Feather name="flag" size={12} color={colors.mutedForeground} /><Text style={styles.caption}>Reported for review</Text></View> : null}
      {item.id === lastMessage?.id && chips.length ? (() => {
        // D-166: section chips ("<name> · 27.5%") draw as full-width rows, one line each, the weight in its own
        // right-hand column so the numbers line up; plain chips stay pills. The tap sends the chip's original text.
        const parts = chipParts(chips);
        const column = hasValues(parts);
        return (
          <View style={column ? styles.choiceColumn : styles.chipRow}>
            {parts.map(({ text: chip, label, value }) => (
              <PressScale scale={PRESS_SCALE.card} key={chip} accessibilityRole="button" accessibilityLabel={value !== null ? `${label}, ${value}` : undefined} disabled={busy}
                onPress={() => (chip === SIM_EXAM_CHIP && focusCourse ? router.push({ pathname: '/course/[courseId]', params: { courseId: focusCourse.id, timed: '1' } })
                  : chip === REVIEW_CHIP && focusCourse ? router.push({ pathname: '/review/[courseId]', params: { courseId: focusCourse.id } }) : void sendText(chip))}
                style={[value !== null ? styles.choiceRow : styles.suggestion, column && value === null && styles.choicePill, busy && styles.disabled]} testID={chip === SIM_EXAM_CHIP ? 'button-suggestion-simulated' : chip === REVIEW_CHIP ? 'button-suggestion-review' : value !== null ? 'button-choice' : 'button-suggestion'}>
                {value !== null ? (
                  <>
                    <Text numberOfLines={1} style={[styles.suggestionText, styles.choiceLabel]}>{label}</Text>
                    <Text numberOfLines={1} style={[styles.suggestionText, styles.choiceValue]}>{value}</Text>
                  </>
                ) : <Text numberOfLines={1} style={styles.suggestionText}>{label}</Text>}
              </PressScale>
            ))}
          </View>
        );
      })() : null}
      {item.actions?.map((action) => action.type === 'update_memory_sheet' ? (
        <View key={`sheet-${action.courseId}-${action.rows?.[0]?.id ?? ''}`} style={styles.actionChip} testID="card-memory-sheet">
          <Feather name="bookmark" size={14} color={colors.primaryText} />
          <Text style={styles.actionText}>Saved to your memory sheet</Text>
        </View>
      ) : action.type === 'fix_upload_notes' ? (
        <View key={`fix-${action.courseId}-${action.name ?? ''}-${action.summary ?? ''}`} style={styles.actionChip} testID="card-upload-notes-fix">
          <Feather name="edit-2" size={14} color={colors.primaryText} />
          <Text style={styles.actionText}>{`Fixed your notes for ${action.name ?? 'that upload'}: ${action.summary ?? ''}`}</Text>
        </View>
      ) : action.type === 'update_course_notes' || action.type === 'undo_course_notes' ? (
        <View key={`notes-${action.type}-${action.courseId}-${action.summary ?? ''}`} style={styles.actionChip} testID="card-course-notes">
          <Feather name={action.type === 'undo_course_notes' ? 'rotate-ccw' : 'edit-2'} size={14} color={colors.primaryText} />
          <Text style={styles.actionText}>{action.type === 'undo_course_notes' ? `Undid in your notes: ${action.summary ?? ''}` : `Updated your notes: ${action.summary ?? ''}`}</Text>
        </View>
      ) : action.type === 'start_quiz' && action.sessionId && action.sessionId === liveSet?.sessionId ? (
        // The latest set: a compact card that opens it over the chat (in progress) or reopens its review (graded).
        <PressScale scale={PRESS_SCALE.card} key={`set-${action.sessionId}`} accessibilityRole="button" onPress={() => { if (activeQuiz?.sessionId !== action.sessionId) setGradedSessionId(action.sessionId!); setStudyOpen(true); }}
          style={[styles.setCard]} testID="card-set">
          <Feather name="edit-3" size={16} color={colors.primaryText} />
          <View style={styles.setCardCopy}>
            <Text style={styles.setCardTitle}>{action.kind === 'practice' ? 'Practice set' : 'Exam set'} · {topicParts(action.topic ?? '').title}</Text>
            {topicParts(action.topic ?? '').sections.map((section) => <Text key={section} style={styles.caption} numberOfLines={1}>{section}</Text>)}
            <Text style={styles.caption}>{activeQuiz?.sessionId === action.sessionId ? `${activeQuiz.answered} of ${activeQuiz.total} answered` : `${action.count ?? ''} questions · graded`}</Text>
          </View>
          <Text style={styles.openLinkText}>{activeQuiz?.sessionId === action.sessionId ? 'Open' : 'Review'}</Text>
        </PressScale>
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
            <PressScale accessibilityRole="button" onPress={() => router.push({ pathname: '/(tabs)/courses', params: { openSession: action.sessionId } })} style={styles.openLink} testID="button-open-session">
              <Text style={styles.openLinkText}>Open</Text>
            </PressScale>
          ) : null}
        </View>
      ))}
    </Pressable>
    </Animated.View>
  );

  const loading = stateQuery.isLoading || chatQuery.isLoading;
  const loadError = stateQuery.error ?? chatQuery.error;
  const showWelcome = !loading && !loadError && shouldShowWelcome(stateQuery.data?.state, replayWelcome, askedFromWelcome);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <AuroraBackground />
      {/* The list icon that was here is the Courses tab now (D-164). */}
      <ScreenHeader mark={<Image source={require('@/assets/images/app-icon.png')} style={styles.brandMark} accessibilityLabel="RapidRecall AI logo" />} title="RapidRecall AI" subtitle="Your coach" style={styles.brandHeader} />

      {loading ? (
        <HomeSkeleton />
      ) : showWelcome ? (
        <Welcome busy={welcomeBusy} onAddCourse={() => void dismissWelcome('add')} />
      ) : loadError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn’t load your chat</Text>
          <Text style={styles.body}>{readableError(loadError)}</Text>
          <PressScale accessibilityRole="button" onPress={() => { void stateQuery.refetch(); void chatQuery.refetch(); }} style={styles.secondaryButton} testID="button-retry-chat">
            <Text style={styles.secondaryButtonText}>Retry</Text>
          </PressScale>
        </View>
      ) : !consented ? (
        <View style={styles.consentWrap}>
          <View style={styles.consentCard} testID="panel-ai-consent">
            <View style={styles.consentHeading}><Feather name="shield" size={19} color={colors.primaryText} /><Text style={styles.cardTitle}>Your choice before AI</Text></View>
            {AI_NOTICE.map((line) => (
              <View key={line.icon} style={styles.consentLine}><Feather name={line.icon} size={16} color={colors.mutedForeground} style={styles.consentIcon} /><Text style={[styles.body, styles.consentText]}>{line.text}</Text></View>
            ))}
            {PRIVACY_URL ? <Text style={[styles.body, styles.link]} accessibilityRole="link" onPress={withTap(openPrivacy)} testID="link-privacy">Read the privacy policy</Text> : null}
            <PressScale gradient accessibilityRole="button" disabled={busy} onPress={() => void giveConsent()} style={[styles.primaryButton, busy && styles.disabled]} testID="button-ai-consent">
              <Feather name="check" size={16} color={colors.primaryForeground} />
              <Text style={styles.primaryButtonText}>I understand and consent</Text>
            </PressScale>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : (
        <View style={styles.chatArea}>
        <FlatList
          ref={listRef}
          data={listData}
          inverted={listData.length > 0}
          onScrollBeginDrag={() => { userScrolledRef.current = true; }}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          // Inverted lists flip their padding: the room under the glass strip is paddingBottom when inverted.
          contentContainerStyle={[styles.list, listData.length > 0 ? { paddingBottom: 12 + stripHeight } : { paddingTop: 12 + stripHeight }]}
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
                      <PressScale key={chip.label} accessibilityRole="button" accessibilityHint={chip.hint} disabled={busy} onPress={chip.onPress} style={[styles.suggestion, busy && styles.disabled]} testID="button-start-chip">
                        <Text style={styles.suggestionText}>{chip.label}</Text>
                      </PressScale>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.body}>Hey. Which course or certification exam are we working on?</Text>
                  {!courses.length ? (
                    <View style={styles.chipRow}>
                      <PressScale accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: '/course-list', params: { add: '1' } })} style={[styles.suggestion, busy && styles.disabled]} testID="button-start-chip">
                        <Text style={styles.suggestionText}>Add a course or exam</Text>
                      </PressScale>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          )}
          ListHeaderComponent={busy && !live ? (() => {
            // D-126, D-191: a filling bar while a set's first questions or a deck are written; dots for a chat.
            const wait = send.isPending ? waitFor(send.variables?.data.content) : null;
            const sending = send.isPending ? send.variables?.data.content : null;
            // D-203: while the report card is written, its first title comes in and waits with the dots; the next miss waits with dots.
            if (sending === FINISHED_SET_MESSAGE) return <EvaluationPlaceholder title={EVALUATION_TITLE} textStyle={styles.sectionTitle} />;
            if (sending === LESSON_START) return <View style={styles.busyRow}><ThinkingDots testID="lesson-thinking" /></View>;
            return wait
              ? <View style={styles.busyRow}><ProgressBar fraction={estimate(sendElapsed, wait.expectedMs)} label={wait.label} testID="progress-first-questions" /></View>
              : <View style={styles.busyRow}><ActivityIndicator color={colors.primaryText} size="small" /><Text style={styles.caption}>Coach is thinking…</Text></View>;
          })() : null}
          testID="list-home-chat"
        />
        {/* The one frosted panel (D-048): the "Coach · <course>" strip, which the chat scrolls under. */}
        <GlassBar style={styles.focusGlass} onLayout={(e) => setStripHeight(Math.round(e.nativeEvent.layout.height))}>
          <PressScale scale={PRESS_SCALE.card} accessibilityRole="button" accessibilityLabel="Courses and exams" accessibilityHint="Choose which course the coach works on, open a course, or add one" onPress={() => (courses.length ? openCourses() : router.navigate({ pathname: '/course-list', params: { add: '1' } }))} style={[styles.focusBar]} testID="button-focus-course">
            <Text style={styles.kicker}>{focusCourse ? 'Studying' : 'Coach'}</Text>
            <Text numberOfLines={1} style={styles.focusText}>{focusCourse ? focusCourse.name : courses.length ? 'All courses' : 'Add a course or exam'}</Text>
            {/* D-188: an exam's countdown in place of the course count, so the date is always in view. */}
            <Text style={styles.focusCount} testID="text-focus-count">{focusCourse?.kind === 'exam' && daysLeft(focusCourse.examDate) !== null ? daysLeftLabel(daysLeft(focusCourse.examDate)!) : courses.length ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}` : ''}</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </PressScale>
        </GlassBar>
        </View>
      )}

      {/* The active question set is docked above the composer, outside the chat scroll, so every
          new question, feedback or score starts at the top of the panel (not at the chat's end). */}
      {consented && !loading && !loadError && activeStudyId && !studyOpen ? (
        <PressScale scale={PRESS_SCALE.card} accessibilityRole="button" onPress={() => setStudyOpen(true)} style={styles.resumeBar} testID="button-resume-study">
          <Feather name={activeDeck ? 'layers' : 'edit-3'} size={16} color={colors.primaryForeground} />
          <Text style={styles.resumeText}>
            {resumeLabel(activeDeck ? { kind: 'deck', done: activeDeck.done, total: activeDeck.total } : { kind: 'quiz', answered: activeQuiz?.answered ?? 0, total: activeQuiz?.total ?? 0 })}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.primaryForeground} />
        </PressScale>
      ) : null}
      {/* The set or deck over the chat (D-059): a dimmed thread behind, a sheet that fills the screen, Back to chat on top. */}
      <Modal visible={studyOpen && Boolean(quizSessionId || deckSessionId) && Boolean(userId)} transparent animationType="fade" onRequestClose={() => setStudyOpen(false)}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chat" onPress={() => setStudyOpen(false)} style={[styles.overlayBackdrop, { height: insets.top + 28 }]} />
          <View style={[styles.overlaySheet, { paddingBottom: insets.bottom }]}>
            <AuroraBackground />
            <ScreenHeader leading="down" leadingLabel="Back to chat" onLeading={() => setStudyOpen(false)} leadingTestID="button-back-to-chat"
              kicker={deckSessionId ? 'Flashcards' : quizIsPractice ? 'Practice' : 'Exam'} title={topicParts((activeDeck ?? activeQuiz)?.topic ?? 'RapidRecall AI').title} />
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
                <QuizCard key={quizSessionId} sessionId={quizSessionId} userId={userId} passMark={focusPassMark}
                  onStepChange={() => quizScrollRef.current?.scrollTo({ y: 0, animated: false })}
                  onGraded={(graded) => { setGradedSessionId(graded.id); void sendText(FINISHED_SET_MESSAGE); }}
                  onError={(problem) => setError(readableError(problem))} />
              ) : null}
              {showStudyDone({ gradedSessionId, activeQuizId: activeQuiz?.sessionId ?? null, deckSessionId, finishedDeckId, activeDeckId: activeDeck?.sessionId ?? null }) ? (
                <>
                  <PressScale accessibilityRole="button" onPress={() => { setStudyOpen(false); setGradedSessionId(null); setFinishedDeckId(null); }} style={styles.backToChat} testID="button-done-study"><Text style={styles.backToChatText}>Back to chat</Text></PressScale>
                  {/* Dan (D-059): the review ends with a way back to the course list. */}
                  <PressScale accessibilityRole="button" onPress={() => { setStudyOpen(false); setGradedSessionId(null); setFinishedDeckId(null); openCourses(); }} style={styles.toCourses} testID="button-done-courses"><Text style={styles.toCoursesText}>Return to course list</Text></PressScale>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {(consented || showWelcome) && !loading && !loadError ? (
        // D-182: the composer is live under the welcome too ("Or ask your coach anything"); it used to be dimmed and inert, which left a new student stuck.
        <View style={styles.composer}>
          {error ? <Text style={styles.errorText} testID="status-chat-error">{error}</Text> : null}
          <View style={styles.composerRow}>
            <PressScale scale={PRESS_SCALE.icon} accessibilityLabel="Add material or record a lecture" accessibilityRole="button" onPress={openPlus} style={styles.plusButton} testID="button-materials-plus">
              <Feather name="plus" size={22} color={colors.primaryForeground} />
            </PressScale>
            {/* The gold ring spins only while the coach is writing a reply or a set (D-048). */}
            <GlowRing active={send.isPending || live !== null} radius={16} style={styles.inputRing}>
            <TextInput
              ref={inputRef}
              value={draft} onChangeText={setDraft} placeholder={composerPlaceholder(showWelcome)} placeholderTextColor={colors.mutedForeground}
              multiline maxLength={8000} style={[styles.input, { height: draft ? draftHeight : 44 }]} editable={!busy} accessibilityLabel="Ask your coach" testID="input-home-chat"
              onContentSizeChange={(e) => setDraftHeight(Math.min(140, Math.max(44, Math.ceil(e.nativeEvent.contentSize.height) + (Platform.OS === 'ios' ? 22 : 16))))}
              returnKeyType="send" blurOnSubmit submitBehavior="blurAndSubmit" onSubmitEditing={() => void sendMessage()}
            />
            </GlowRing>
            {/* D-171: when there is nothing to send the button is the soft fill with a grey arrow, not a faded primary (which read as broken). */}
            <PressScale scale={PRESS_SCALE.icon} gradient={!busy && !!draft.trim()} accessibilityLabel="Send" accessibilityRole="button" accessibilityState={{ disabled: busy || !draft.trim() }} disabled={busy || !draft.trim()} onPress={() => void sendMessage()} style={[styles.sendButton, (busy || !draft.trim()) && styles.sendButtonOff]} testID="button-send-home-chat">
              <Feather name="send" size={18} color={busy || !draft.trim() ? colors.mutedForeground : colors.primaryForeground} />
            </PressScale>
          </View>
        </View>
      ) : null}

      <Modal visible={intakeCourse !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!intakeBusy) setIntakeCourseId(null); }}>
        {intakeCourse ? (
          <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: 20 }]}>
            <ScreenHeader kicker="Add material" title={`Add to ${intakeCourse.name}`} subtitle="Photos, files, a website, or a lecture recording" right={<HeaderIconButton icon="x" label="Close" disabled={intakeBusy} onPress={() => setIntakeCourseId(null)} testID="button-close-intake" />} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 30 }]}>
              {courses.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {courses.map((course) => (
                    <PressScale key={course.id} accessibilityRole="button" accessibilityState={{ selected: course.id === intakeCourse.id }} disabled={intakeBusy}
                      onPress={() => setIntakeCourseId(course.id)} style={[styles.chip, course.id === intakeCourse.id && styles.chipSelected]} testID={`chip-course-${course.id}`}>
                      <Text style={[styles.chipText, course.id === intakeCourse.id && styles.chipTextSelected]}>{course.name}</Text>
                    </PressScale>
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
                // D-186: straight into questions on this course once something is saved.
                onStartQuestions={() => { const id = intakeCourse.id; setIntakeCourseId(null); selectCourse(id); handoffSentRef.current = null; router.setParams({ send: studyRequest('practice', null), courseId: id }); }}
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
  brandHeader: { paddingLeft: 18, gap: 12 },
  brandMark: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 18, paddingVertical: 12, gap: 12 },
  // Transcript look (D-043): the coach's turns sit flush left with no tint; yours are bubbles on the right.
  turn: { gap: 7, alignSelf: 'stretch' },
  userTurn: { backgroundColor: colors.secondary, alignSelf: 'flex-end', maxWidth: '88%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 6 },
  coachTurn: { alignSelf: 'stretch', paddingHorizontal: 2, paddingVertical: 4 },
  turnRole: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  coachBlocks: { gap: 8 },
  bold: { fontWeight: '700' },
  heading: { color: colors.foreground, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  headingGap: { marginTop: 12 },
  bulletRow: { flexDirection: 'row', gap: 8, paddingLeft: 2, marginBottom: 2 },
  popQuiz: { gap: 6, padding: 14, borderRadius: 14, backgroundColor: colors.navyBg, marginTop: 6 }, // D-171: the one navy card in the chat
  popQuizHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  popQuizTitle: { color: colors.navyText, fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  popQuizText: { color: colors.navyText, fontSize: 16, lineHeight: 23 }, // Dan: plain text; the box is enough
  popQuizHint: { color: colors.navyText, fontSize: 13, opacity: 0.8 },
  quoteRow: { borderLeftWidth: 3, borderLeftColor: colors.primaryText, borderRadius: 10, backgroundColor: colors.secondary, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 4 }, // D-193: a tinted box (readiness, the takeaway)
  coachSection: { gap: 8 },
  thoughtGap: { marginTop: 8 }, // D-206: a blank line in the reply is a new thought: more room above it
  coachSectionRule: { marginTop: 10, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sectionTitle: { color: colors.primaryText, fontSize: 13, lineHeight: 18, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  tipCard: { gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginTop: 4 },
  tipTitle: { color: colors.foreground, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  bulletText: { flex: 1 },
  trickCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 14, backgroundColor: colors.hookBg },
  trickText: { flex: 1, color: colors.hookText, fontSize: 13.5, lineHeight: 19.5 },
  trickLabel: { fontWeight: '700', color: colors.hookText }, // D-171: amber trick card
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
  suggestionText: { color: colors.highlightText, fontSize: 13.5, lineHeight: 18, fontWeight: '600' }, // D-170: amber text on the amber chip
  choiceColumn: { gap: 8, marginTop: 6 },
  choiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.chipBorder, backgroundColor: colors.chipBg },
  choiceLabel: { flex: 1, fontSize: 15, lineHeight: 20 },
  // A fixed column, right-aligned, tabular digits: every weight sits under the one above it.
  choiceValue: { width: 58, textAlign: 'right', fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
  choicePill: { alignSelf: 'flex-start' },
  composer: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  plusButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  inputRing: { flex: 1 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, lineHeight: 20, paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 11 : 8 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendButtonOff: { backgroundColor: colors.secondary },
  disabled: { opacity: 0.45 },
  consentWrap: { flex: 1, padding: 18, gap: 10 },
  consentCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 20, gap: 12 },
  consentLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  consentIcon: { marginTop: 3 },
  consentText: { flex: 1 },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  secondaryButtonText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  errorCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.destructive, padding: 15, borderRadius: 16, gap: 8, marginHorizontal: 18, marginTop: 13 },
  errorTitle: { color: colors.destructive, fontSize: 15, fontWeight: '700' },
  errorText: { color: colors.destructive, fontSize: 13 },
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
