import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { PRESS_SCALE, PressScale } from '@/components/PressScale';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer,
  type StudyQuestionFlagInputKind, type StudySession, type StudyQuizQuestionsItem,
} from '@workspace/api-client-react';
import { Confetti } from '@/components/Confetti';
import { AnswerMark } from '@/components/AnswerMark';
import { useAnswerSounds } from '@/hooks/useAnswerSounds';
import { answerKind, shouldPlayAnswerSound, shouldShowAnswerMark } from '@/lib/answer-feedback';
import { feedbackHaptic, playFeedbackSound, prepareFeedbackSounds } from '@/lib/feedback-sounds';
import { ProgressBar } from '@/components/ProgressBar';
import { writtenProgress } from '@/lib/progress';
import { isPerfect } from '@/lib/perfect-score';
import { useColors } from '@/hooks/useColors';
import { FONT, TYPE } from '@/constants/type';
import { topicParts } from '@/lib/topic-label';
import { canGrade, clockText, clockTone, scoreLine, secondsLeft, timeUsedLine } from '@/lib/exam-sheet';

/**
 * One question at a time inside the chat (SPEC §6 steps 4–5). Practice sets show the
 * correct answer and why right after each tap; exam sets only after Grade. Answers are
 * saved on the server as they are tapped, so leaving and coming back resumes.
 * "Looks wrong?" (D-034) reports a question: the server re-checks it with an independent
 * model and the verdict shows in place; a confirmed key still counts, a wrong or unclear
 * key takes the question out of the score.
 * Exam sets (D-037, Dan's design): numbered bubbles, all visible at once, jump to any
 * question. Fill = answered (green); outline = marked for review (red); so a marked but
 * unanswered question is a white bubble with a red ring, and a marked answered one is green
 * with a red ring. Marks live on this phone per set.
 */
export function QuizCard({ sessionId, userId, passMark, onGraded, onError, onStepChange }: {
  sessionId: string;
  userId: string | null | undefined;
  /** The real exam's pass mark line, shown on a timed exam's score (D-115). */
  passMark?: string;
  /** Called once when the student taps Grade and the server has graded the set. */
  onGraded: (session: StudySession) => void;
  onError: (problem: unknown) => void;
  /** Fires when what the card shows changes (next question, feedback, grade, score), so the parent can scroll to its top. */
  onStepChange?: (step: string) => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const key = [...getGetStudySessionQueryKey(sessionId), userId];
  // A two-part set (D-052) is polled while the rest of it is still being written.
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key, enabled: !!userId, refetchInterval: (query) => (query.state.data?.quiz?.status === 'writing' ? 1500 : false) } });
  const saveAnswer = useSaveStudyAnswer();
  const grade = useGradeStudyQuiz();
  const flag = useFlagStudyQuestion();
  const [reviewingId, setReviewingId] = useState<string | null>(null); // practice: the question whose feedback is on screen
  const [justAnsweredId, setJustAnsweredId] = useState<string | null>(null); // D-172: the verdict whose mark is rising
  const answerSounds = useAnswerSounds();
  useEffect(() => { void prepareFeedbackSounds(); }, []); // D-172
  const [reportingId, setReportingId] = useState<string | null>(null); // the question whose re-check is running
  const [currentId, setCurrentId] = useState<string | null>(null); // exam: the question on screen (null = first unanswered)
  const [marks, setMarks] = useState<Set<string>>(new Set()); // exam: questions marked for review (kept per set on this phone)
  const marksKey = `study-coach-marks:${sessionId}`;
  useEffect(() => {
    AsyncStorage.getItem(marksKey).then((saved) => { if (saved) setMarks(new Set(JSON.parse(saved) as string[])); }).catch(() => {});
  }, [marksKey]);
  const toggleMark = (id: string) => {
    setMarks((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      AsyncStorage.setItem(marksKey, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  };
  const clearMarks = () => { setMarks(new Set()); AsyncStorage.removeItem(marksKey).catch(() => {}); };
  const session = sessionQuery.data;
  const quiz = session?.quiz ?? null;
  const busy = saveAnswer.isPending || grade.isPending;
  // A reported question stays out of the set unless the re-check confirmed its key.
  const counts = (q: StudyQuizQuestionsItem) => !q.flag || q.flag.recheck?.verdict === 'key_holds';
  const step = !quiz ? 'loading' : quiz.grade ? 'score' : reviewingId ? `feedback:${reviewingId}` : `question:${currentId ?? quiz.questions.find((q) => counts(q) && !q.answer)?.id ?? 'grade'}`;
  useEffect(() => { onStepChange?.(step); }, [step]);

  // Timed exams (D-115): the clock ticks every second from the server's deadline (wall-clock, so
  // it is right after the app was closed). At 0:00 the set is graded with what was answered; if
  // the server isn't there yet (phone clock a little fast), it tries again a few seconds later.
  const timer = quiz && !quiz.grade ? quiz.timer ?? null : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer?.deadline]);
  const left = timer ? secondsLeft(timer.deadline, now) : null;
  const autoGrading = useRef(false);
  const gradeNow = async (): Promise<boolean> => {
    try {
      const graded = await grade.mutateAsync({ id: sessionId });
      queryClient.setQueryData(key, graded);
      clearMarks();
      onGraded(graded);
      return true;
    } catch (problem) { onError(problem); return false; }
  };
  useEffect(() => {
    if (left !== 0 || autoGrading.current || grade.isPending) return;
    autoGrading.current = true;
    void (async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const graded = await grade.mutateAsync({ id: sessionId });
          queryClient.setQueryData(key, graded);
          clearMarks();
          onGraded(graded);
          return;
        } catch { await new Promise((r) => setTimeout(r, 3000)); }
      }
      autoGrading.current = false;
      void sessionQuery.refetch();
    })();
  }, [left]);

  if (sessionQuery.isLoading) return <View style={styles.card}><ActivityIndicator color={colors.primaryText} /><CardText style={styles.muted}>Loading your questions…</CardText></View>;
  if (!session || !quiz) {
    return <View style={styles.card}><CardText style={styles.muted}>Couldn’t load this set.</CardText>
      <Pressable accessibilityRole="button" onPress={() => void sessionQuery.refetch()} style={styles.secondaryButton} testID="button-retry-quiz"><CardText style={styles.secondaryText}>Retry</CardText></Pressable></View>;
  }

  const questions = quiz.questions.filter(counts);
  const answered = questions.filter((q) => q.answer);
  const kindLabel = quiz.kind === 'practice' ? 'Practice' : 'Exam';
  const writing = quiz.status === 'writing';
  // While the rest is on its way, the set's size is what it will be, so "Question 2 of 10" stays true.
  const total = writing ? Math.max(quiz.expectedCount, questions.length) : questions.length;

  const report = (question: StudyQuizQuestionsItem) => {
    const send = async (kind: StudyQuestionFlagInputKind) => {
      setReportingId(question.id);
      try {
        const updated = await flag.mutateAsync({ id: sessionId, questionId: question.id, data: { kind } });
        queryClient.setQueryData(key, updated);
      } catch (problem) { onError(problem); } finally { setReportingId(null); }
    };
    Alert.alert('Something wrong with this question?', 'The coach will check it again right away.', [
      { text: 'The answer is wrong', onPress: () => void send('wrong_answer') },
      { text: 'The question is unclear', onPress: () => void send('ambiguous') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // The report link, or the verdict once the question was reported.
  const reportNote = (question: StudyQuizQuestionsItem) => {
    if (reportingId === question.id) return <View style={styles.note} testID="status-recheck"><ActivityIndicator color={colors.primaryText} size="small" /><CardText style={styles.noteText}>Checking the answer again…</CardText></View>;
    const recheck = question.flag?.recheck;
    if (question.flag && !recheck) return <View style={styles.note} testID="note-recheck"><Feather name="flag" size={14} color={colors.mutedForeground} /><CardText style={styles.noteText}>Reported. This question won’t count.</CardText></View>;
    if (recheck) {
      const youWereRight = recheck.verdict === 'key_wrong' && !!question.answer && recheck.correctOptionId === question.answer.optionId;
      const headline = recheck.verdict === 'key_holds' ? 'Checked again: the answer key holds.'
        : recheck.verdict === 'key_wrong' ? (youWereRight ? `You’re right. The correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count against you.` : `The answer key was wrong: the correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count.`)
        : 'This question is unclear, so it won’t count.';
      return (
        <View style={styles.note} testID={`note-recheck-${recheck.verdict}`}>
          <Feather name={recheck.verdict === 'key_holds' ? 'check-circle' : 'alert-circle'} size={14} color={recheck.verdict === 'key_holds' ? colors.mutedForeground : colors.primaryText} />
          <CardText style={styles.noteText}><CardText style={styles.noteStrong}>{headline}</CardText> {recheck.explanation}</CardText>
        </View>
      );
    }
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Report this question" disabled={!!reportingId} onPress={() => report(question)} style={styles.reportLink} testID={`button-report-${question.id}`}>
        <CardText style={styles.reportLinkText}>Looks wrong?</CardText>
      </Pressable>
    );
  };

  const progress = (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: answered.length }}>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${total ? Math.round((answered.length / total) * 100) : 0}%` }]} /></View>
      <CardText style={styles.progressText}>{answered.length} of {total} answered</CardText>
    </View>
  );

  // The clock, at the top of every exam panel (spec B): mm:ss, amber at 5 minutes, red at 1, never colour alone.
  const tone = left === null ? 'normal' : clockTone(left);
  const clock = left === null ? null : (
    <View style={[styles.clock, tone !== 'normal' && { borderColor: tone === 'red' ? colors.wrong : colors.timerAmber }]} accessibilityRole="timer"
      accessibilityLabel={`${clockText(left)} left`} testID="text-exam-clock">
      <Feather name="clock" size={16} color={tone === 'red' ? colors.wrong : tone === 'amber' ? colors.timerAmber : colors.mutedForeground} />
      <CardText style={[styles.clockText, tone === 'red' ? { color: colors.wrong } : tone === 'amber' ? { color: colors.timerAmber } : null]}>{clockText(left)}</CardText>
      <CardText style={styles.clockNote}>{left === 0 ? 'Time is up. Grading…' : tone === 'red' ? 'Under a minute left' : tone === 'amber' ? 'Under 5 minutes left' : `of ${clockText((timer?.limitMinutes ?? 0) * 60)}`}</CardText>
    </View>
  );

  if (quiz.grade) {
    // Misses, plus reported questions (with their verdict) so the student sees what happened to them.
    const misses = quiz.questions.filter((q) => q.feedback && q.feedback.selectedOptionId && (q.feedback.selectedOptionId !== q.feedback.correctOptionId || (q.flag && !counts(q))));
    return (
      <View style={styles.card} testID="panel-quiz-score">
        <Confetti sessionId={sessionId} perfect={isPerfect(quiz.grade)} />
        {/* D-130: "All topics" with each section on its own line, not one long capitalised run. */}
        <CardText style={styles.kicker}>{kindLabel} · {topicParts(session.topic).title}</CardText>
        {topicParts(session.topic).sections.map((section) => <CardText key={section} style={styles.sectionLine}>{section}</CardText>)}
        <View style={styles.scoreRow}><CardText style={styles.score}>{quiz.grade.correct}</CardText><CardText style={styles.scoreOf}> / {quiz.grade.limitMinutes ? quiz.grade.answered + quiz.grade.unanswered : quiz.grade.answered}</CardText></View>
        {/* Dan (2026-10-12): "20% on the questions you answered" read like 20% missed. Say the score plainly. */}
        <CardText style={styles.body}>{scoreLine(quiz.grade)}</CardText>
        {timeUsedLine(quiz.grade) ? <CardText style={styles.muted} testID="text-time-used">{timeUsedLine(quiz.grade)}</CardText> : null}
        {quiz.grade.limitMinutes && passMark ? <CardText style={styles.muted} testID="text-pass-mark">{passMark}</CardText> : null}
        {misses.length ? <CardText style={styles.cardTitle}>Questions you missed</CardText> : <CardText style={styles.cardTitle}>Nothing missed. Nice.</CardText>}
        {misses.map((q, i) => (
          // Grok's review layout (D-070): concept, question, the trick first, then your answer and the best answer as labelled lines.
          <View key={q.id} style={styles.miss} testID={`quiz-miss-${i}`}>
            {q.concept ? <CardText style={styles.missKicker}>{q.concept}</CardText> : null}
            <CardText style={styles.missPrompt}>{q.prompt}</CardText>
            {q.feedback!.hook ? (
              <View style={styles.hook}>
                <View style={styles.hookHead}><Feather name="zap" size={14} color={colors.hookText} /><CardText style={styles.hookKicker}>Remember it this way</CardText></View>
                <CardText style={styles.hookText}>{q.feedback!.hook}</CardText>
              </View>
            ) : null}
            <View style={styles.answerLine}><CardText style={[styles.answerLabel, { color: colors.wrong }]}>Your answer</CardText><CardText style={styles.answerText}>{q.feedback!.selectedOptionText}</CardText></View>
            <View style={styles.answerLine}><CardText style={[styles.answerLabel, { color: colors.correct }]}>Best answer</CardText><CardText style={styles.answerText}>{q.feedback!.correctOptionText}</CardText></View>
            <CardText style={styles.missExplain}>{q.feedback!.explanation}</CardText>
            {reportNote(q)}
          </View>
        ))}
      </View>
    );
  }

  const reviewing = reviewingId ? quiz.questions.find((q) => q.id === reviewingId) : undefined;
  if (reviewing?.feedback) {
    const correct = reviewing.feedback.selectedOptionId === reviewing.feedback.correctOptionId;
    const position = questions.indexOf(reviewing);
    return (
      <View style={styles.card} testID="panel-quiz-feedback">
        <CardText style={styles.kicker}>{kindLabel} · {position >= 0 ? `Question ${position + 1} of ${total}` : 'Reported question'}</CardText>
        <View style={styles.miss}>
          <CardText style={styles.missPrompt}>{reviewing.prompt}</CardText>
          <View style={styles.verdict}>
            <Feather name={correct ? 'check-circle' : 'x-circle'} size={18} color={correct ? colors.correct : colors.wrong} />
            <CardText style={[styles.verdictText, { color: correct ? colors.correct : colors.wrong }]}>
              {correct ? 'Correct' : 'Not quite'}
              {justAnsweredId === reviewing.id ? <AnswerMark kind={correct ? 'correct' : 'wrong'} lineHeight={TYPE.bodySemi.lineHeight} /> : null}
            </CardText>
          </View>
          {!correct ? <View style={styles.answerLine}><CardText style={[styles.answerLabel, { color: colors.wrong }]}>Your answer</CardText><CardText style={styles.answerText}>{reviewing.feedback.selectedOptionText}</CardText></View> : null}
          <View style={styles.answerLine}><CardText style={[styles.answerLabel, { color: colors.correct }]}>Best answer</CardText><CardText style={styles.answerText}>{reviewing.feedback.correctOptionText}</CardText></View>
          <CardText style={styles.missExplain}>{reviewing.feedback.explanation}</CardText>
          {!correct && reviewing.feedback.hook ? <View style={styles.hook}><View style={styles.hookHead}><Feather name="zap" size={14} color={colors.hookText} /><CardText style={styles.hookKicker}>Remember it this way</CardText></View><CardText style={styles.hookText}>{reviewing.feedback.hook}</CardText></View> : null}
          {reportNote(reviewing)}
        </View>
        {progress}
        <PressScale gradient accessibilityRole="button" onPress={() => { setJustAnsweredId(null); setReviewingId(null); }} style={styles.primaryButton} testID="button-quiz-next">
          <CardText style={styles.primaryText}>{answered.length >= questions.length && !writing ? 'See the score' : 'Next question'}</CardText>
        </PressScale>
      </View>
    );
  }

  const isExam = quiz.kind !== 'practice';
  const marked = questions.filter((q) => marks.has(q.id));
  // Exam sets: numbered bubbles, all on screen (no slider), jump to any question. Fill = answered, ring = marked.
  const bubbles = isExam ? (
    <View style={styles.bubbles} testID="row-quiz-bubbles">
      {questions.map((q, i) => {
        const answered = !!q.answer;
        const marked = marks.has(q.id);
        const here = (currentId ?? questions.find((x) => !x.answer)?.id) === q.id;
        const label = `Question ${i + 1}, ${answered ? 'answered' : 'not answered'}${marked ? ', marked for review' : ''}`;
        return (
          <Pressable key={q.id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: here }}
            hitSlop={8} onPress={() => setCurrentId(q.id)} style={[styles.bubble, answered && styles.bubbleAnswered, marked && styles.bubbleMarked, here && styles.bubbleHere]} testID={`button-quiz-bubble-${i}`}>
            <CardText style={[styles.bubbleText, answered && styles.bubbleTextAnswered]}>{i + 1}</CardText>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  const current: StudyQuizQuestionsItem | undefined = (isExam && currentId ? questions.find((q) => q.id === currentId) : undefined) ?? questions.find((q) => !q.answer);
  if (!current && writing) {
    // The first part is answered and the rest has not landed yet: the card waits (polling above), no Grade yet.
    return (
      <View style={styles.card} testID="panel-quiz-writing">
        {clock}
        {/* D-130: "All topics" with each section on its own line, not one long capitalised run. */}
        <CardText style={styles.kicker}>{kindLabel} · {topicParts(session.topic).title}</CardText>
        {topicParts(session.topic).sections.map((section) => <CardText key={section} style={styles.sectionLine}>{section}</CardText>)}
        {progress}
        {bubbles}
        {/* D-126: the real count of questions written so far. */}
        <ProgressBar {...writtenProgress(questions.length, total)} testID="progress-writing" />
      </View>
    );
  }
  // Grade is reachable from every question once all are answered (Dan: after going back to review
  // one there was no way to grade). Marks never block it: grading counts the answers as they stand.
  const allAnswered = canGrade(questions.length, answered.length, writing);
  const gradeBlock = allAnswered ? (
    <View style={styles.gradeBlock}>
      {marked.length ? <CardText style={styles.muted}>{marked.length} still marked for review. Grading counts the answers you have now.</CardText> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void gradeNow()} style={[styles.primaryButton, busy && styles.disabled]} testID="button-quiz-grade">
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <CardText style={styles.primaryText}>Grade exam</CardText>}
      </Pressable>
    </View>
  ) : null;
  if (!current) {
    return (
      <View style={styles.card} testID="panel-quiz-grade">
        {clock}
        {/* D-130: "All topics" with each section on its own line, not one long capitalised run. */}
        <CardText style={styles.kicker}>{kindLabel} · {topicParts(session.topic).title}</CardText>
        {topicParts(session.topic).sections.map((section) => <CardText key={section} style={styles.sectionLine}>{section}</CardText>)}
        <CardText style={styles.cardTitle}>All {questions.length} answered.</CardText>
        {bubbles}
        {!marked.length ? <CardText style={styles.muted}>Tap a bubble to look at a question again, or grade now.</CardText> : null}
        {gradeBlock}
      </View>
    );
  }

  const choose = async (optionId: string) => {
    if (busy) return;
    try {
      const updated = await saveAnswer.mutateAsync({ id: sessionId, data: { questionId: current.id, optionId, assisted: false } });
      queryClient.setQueryData(key, updated);
      if (quiz.kind === 'practice') {
        setReviewingId(current.id);
        // D-172: the verdict lands with a mark, a haptic and (untimed, switched on) a sound. Exams judge nothing until the end.
        const kind = answerKind(updated.quiz?.questions.find((q) => q.id === current.id)?.feedback);
        const timed = !!updated.quiz?.timer;
        if (kind && shouldShowAnswerMark({ timed })) {
          setJustAnsweredId(current.id);
          feedbackHaptic(kind);
          if (shouldPlayAnswerSound({ enabled: answerSounds.enabled, timed })) void playFeedbackSound(kind);
        }
        return;
      }
      // Exam: move on to the next unanswered question after this one (wrapping), else the "all answered" panel.
      const list = (updated.quiz?.questions ?? []).filter(counts);
      const at = list.findIndex((q) => q.id === current.id);
      const next = [...list.slice(at + 1), ...list.slice(0, at)].find((q) => !q.answer);
      setCurrentId(next?.id ?? null);
    } catch (problem) {
      // Out of time (D-112): the server took no more answers; grade what is there instead of showing an error.
      if ((problem as { data?: { timeUp?: unknown } }).data?.timeUp === true) { void gradeNow(); return; }
      onError(problem);
    }
  };

  const chosen = isExam ? current.answer?.optionId ?? null : null;
  return (
    <View style={styles.card} testID="panel-quiz-question">
      {clock}
      <CardText style={styles.kicker}>{kindLabel} · Question {questions.indexOf(current) + 1} of {total}</CardText>
      {progress}
      {bubbles}
      <CardText style={styles.prompt}>{current.prompt}</CardText>
      {current.options.map((option, i) => (
        <PressScale key={option.id} scale={PRESS_SCALE.card} haptic={false} accessibilityRole="button" accessibilityState={{ selected: chosen === option.id }} disabled={busy} onPress={() => void choose(option.id)}
          style={[styles.option, chosen === option.id && styles.optionChosen, busy && styles.disabled]} testID={`button-quiz-option-${i}`}>
          <CardText style={[styles.optionLetter, chosen === option.id && styles.optionLetterChosen]}>{'ABCDE'[i]}</CardText>
          <CardText style={styles.optionText}>{option.text}</CardText>
        </PressScale>
      ))}
      {isExam ? (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: marks.has(current.id) }} onPress={() => toggleMark(current.id)} style={[styles.markButton, marks.has(current.id) && styles.markButtonOn]} testID="button-quiz-mark">
          <Feather name="flag" size={15} color={marks.has(current.id) ? colors.wrong : colors.foreground} />
          <CardText style={[styles.markText, marks.has(current.id) && { color: colors.wrong }]}>{marks.has(current.id) ? 'Marked for review' : 'Mark for review'}</CardText>
        </Pressable>
      ) : null}
      {isExam ? gradeBlock : null}
      {busy && !allAnswered ? <ActivityIndicator color={colors.primaryText} /> : null}
    </View>
  );
}

/** Card text ignores the phone's Text Size, as the live practice card does (D-053). */
function CardText(props: React.ComponentProps<typeof Text>) {
  return <Text maxFontSizeMultiplier={1} {...props} />;
}

// Exam sheet type and colours (D-070): the same faces and sizes as the live practice card
// (Source Sans 3, Fraunces for the score), and the review laid out like Dan's Grok reference:
// light cards, the trick in a tinted card, "Your answer" / "Best answer" as labelled lines.
const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 12 },
  sectionLine: { ...TYPE.small, color: colors.mutedForeground },
  kicker: { ...TYPE.kicker, color: colors.mutedForeground },
  prompt: { ...TYPE.prompt, color: colors.foreground },
  body: { ...TYPE.body, color: colors.foreground },
  muted: { ...TYPE.small, color: colors.mutedForeground },
  progress: { gap: 4 },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.background },
  clockText: { fontFamily: FONT.sansBold, fontSize: 20, color: colors.foreground, fontVariant: ['tabular-nums'] },
  clockNote: { ...TYPE.small, color: colors.mutedForeground },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.secondary, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: colors.primary },
  progressText: { ...TYPE.small, color: colors.mutedForeground },
  hook: { gap: 6, padding: 14, borderRadius: 14, backgroundColor: colors.hookBg },
  hookHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hookKicker: { ...TYPE.smallSemi, color: colors.hookText },
  hookText: { ...TYPE.bodySemi, color: colors.hookText }, // D-171: amber box, amber text
  cardTitle: { ...TYPE.heading, fontSize: 24, lineHeight: 30, color: colors.foreground },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.background, paddingHorizontal: 13, paddingVertical: 10 },
  optionChosen: { borderColor: colors.primary, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 9 },
  optionLetterChosen: { backgroundColor: colors.primary, color: colors.primaryForeground },
  // 28 pt + 6 pt gaps: ten per row on an iPhone, so twenty questions take two rows (Dan). hitSlop keeps the touch target at 44 pt.
  bubbles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  bubble: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.mutedForeground, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  bubbleAnswered: { borderColor: colors.correct, backgroundColor: colors.correct }, // fill = answered
  bubbleMarked: { borderColor: colors.wrong }, // ring = marked, whether answered or not
  bubbleHere: { transform: [{ scale: 1.18 }] },
  bubbleText: { fontFamily: FONT.sansBold, fontSize: 12, color: colors.foreground },
  bubbleTextAnswered: { color: '#ffffff' },
  markButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  markButtonOn: { borderColor: colors.wrong },
  markText: { ...TYPE.smallSemi, color: colors.foreground },
  optionLetter: { ...TYPE.letter, width: 28, height: 28, borderRadius: 14, textAlign: 'center', overflow: 'hidden', backgroundColor: colors.secondary, color: colors.foreground },
  optionText: { ...TYPE.option, flex: 1, color: colors.foreground },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictText: { ...TYPE.bodySemi, fontSize: 17 },
  miss: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  missKicker: { ...TYPE.kicker, fontSize: 13, color: colors.primaryText }, // D-154: hookText on the light miss box was 1.45:1
  missPrompt: { ...TYPE.bodySemi, fontSize: 17, lineHeight: 24, color: colors.foreground },
  answerLine: { gap: 2 },
  answerLabel: { ...TYPE.smallSemi },
  answerText: { ...TYPE.body, color: colors.foreground },
  missExplain: { ...TYPE.small, color: colors.mutedForeground },
  // Report link: small and away from the main button on purpose (UX_PRINCIPLES: destructive-ish actions are small and separated).
  reportLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  reportLinkText: { ...TYPE.smallSemi, color: colors.mutedForeground, textDecorationLine: 'underline' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.card },
  noteText: { ...TYPE.small, flex: 1, color: colors.foreground },
  noteStrong: { fontFamily: FONT.sansSemi },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  score: { ...TYPE.score, color: colors.foreground, fontVariant: ['tabular-nums'] },
  scoreOf: { ...TYPE.scoreOf, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  gradeBlock: { gap: 8, marginTop: 4 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryText: { ...TYPE.button, color: colors.primaryForeground },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { ...TYPE.smallSemi, color: colors.foreground },
  disabled: { opacity: 0.5 },
});
