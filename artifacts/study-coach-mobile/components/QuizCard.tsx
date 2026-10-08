import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer,
  type StudyQuestionFlagInputKind, type StudySession, type StudyQuizQuestionsItem,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

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
export function QuizCard({ sessionId, userId, onGraded, onError, onStepChange }: {
  sessionId: string;
  userId: string | null | undefined;
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
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key, enabled: !!userId } });
  const saveAnswer = useSaveStudyAnswer();
  const grade = useGradeStudyQuiz();
  const flag = useFlagStudyQuestion();
  const [reviewingId, setReviewingId] = useState<string | null>(null); // practice: the question whose feedback is on screen
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
  const session = sessionQuery.data;
  const quiz = session?.quiz ?? null;
  const busy = saveAnswer.isPending || grade.isPending;
  // A reported question stays out of the set unless the re-check confirmed its key.
  const counts = (q: StudyQuizQuestionsItem) => !q.flag || q.flag.recheck?.verdict === 'key_holds';
  const step = !quiz ? 'loading' : quiz.grade ? 'score' : reviewingId ? `feedback:${reviewingId}` : `question:${currentId ?? quiz.questions.find((q) => counts(q) && !q.answer)?.id ?? 'grade'}`;
  useEffect(() => { onStepChange?.(step); }, [step]);

  if (sessionQuery.isLoading) return <View style={styles.card}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading your questions…</Text></View>;
  if (!session || !quiz) {
    return <View style={styles.card}><Text style={styles.muted}>Couldn’t load this set.</Text>
      <Pressable accessibilityRole="button" onPress={() => void sessionQuery.refetch()} style={styles.secondaryButton} testID="button-retry-quiz"><Text style={styles.secondaryText}>Retry</Text></Pressable></View>;
  }

  const questions = quiz.questions.filter(counts);
  const answered = questions.filter((q) => q.answer);
  const kindLabel = quiz.kind === 'practice' ? 'Practice' : 'Exam';

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
    if (reportingId === question.id) return <View style={styles.note} testID="status-recheck"><ActivityIndicator color={colors.primary} size="small" /><Text style={styles.noteText}>Checking the answer again…</Text></View>;
    const recheck = question.flag?.recheck;
    if (question.flag && !recheck) return <View style={styles.note} testID="note-recheck"><Feather name="flag" size={14} color={colors.mutedForeground} /><Text style={styles.noteText}>Reported. This question won’t count.</Text></View>;
    if (recheck) {
      const youWereRight = recheck.verdict === 'key_wrong' && !!question.answer && recheck.correctOptionId === question.answer.optionId;
      const headline = recheck.verdict === 'key_holds' ? 'Checked again: the answer key holds.'
        : recheck.verdict === 'key_wrong' ? (youWereRight ? `You’re right. The correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count against you.` : `The answer key was wrong: the correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count.`)
        : 'This question is unclear, so it won’t count.';
      return (
        <View style={styles.note} testID={`note-recheck-${recheck.verdict}`}>
          <Feather name={recheck.verdict === 'key_holds' ? 'check-circle' : 'alert-circle'} size={14} color={recheck.verdict === 'key_holds' ? colors.mutedForeground : colors.primary} />
          <Text style={styles.noteText}><Text style={styles.noteStrong}>{headline}</Text> {recheck.explanation}</Text>
        </View>
      );
    }
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Report this question" disabled={!!reportingId} onPress={() => report(question)} style={styles.reportLink} testID={`button-report-${question.id}`}>
        <Text style={styles.reportLinkText}>Looks wrong?</Text>
      </Pressable>
    );
  };

  const progress = (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: questions.length, now: answered.length }}>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${questions.length ? Math.round((answered.length / questions.length) * 100) : 0}%` }]} /></View>
      <Text style={styles.progressText}>{answered.length} of {questions.length} answered</Text>
    </View>
  );

  if (quiz.grade) {
    // Misses, plus reported questions (with their verdict) so the student sees what happened to them.
    const misses = quiz.questions.filter((q) => q.feedback && q.feedback.selectedOptionId && (q.feedback.selectedOptionId !== q.feedback.correctOptionId || (q.flag && !counts(q))));
    return (
      <View style={styles.card} testID="panel-quiz-score">
        <Text style={styles.kicker}>{kindLabel.toUpperCase()} · {session.topic}</Text>
        <Text style={styles.score}>{quiz.grade.correct} / {quiz.grade.answered}</Text>
        <Text style={styles.body}>{quiz.grade.percent}% on the questions you answered{quiz.grade.unanswered ? ` · ${quiz.grade.unanswered} skipped` : ''}.</Text>
        {misses.length ? <Text style={styles.cardTitle}>What you missed</Text> : <Text style={styles.cardTitle}>Nothing missed. Nice.</Text>}
        {misses.map((q, i) => (
          <View key={q.id} style={styles.miss} testID={`quiz-miss-${i}`}>
            <Text style={styles.missPrompt}>{q.prompt}</Text>
            <Text style={styles.wrong}>You chose: {q.feedback!.selectedOptionText}</Text>
            <Text style={styles.right}>Correct: {q.feedback!.correctOptionText}</Text>
            <Text style={styles.missExplain}>{q.feedback!.explanation}</Text>
            {q.feedback!.hook ? <View style={styles.hook}><Feather name="zap" size={14} color={DARK.hookText} /><Text style={styles.hookText}>{q.feedback!.hook}</Text></View> : null}
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
        <Text style={styles.kicker}>{kindLabel.toUpperCase()} · {position >= 0 ? `QUESTION ${position + 1} OF ${questions.length}` : 'REPORTED QUESTION'}</Text>
        <View style={styles.miss}>
          <Text style={styles.missPrompt}>{reviewing.prompt}</Text>
          <View style={styles.verdict}>
            <Feather name={correct ? 'check-circle' : 'x-circle'} size={18} color={correct ? DARK.right : DARK.wrong} />
            <Text style={[styles.verdictText, { color: correct ? DARK.right : DARK.wrong }]}>{correct ? 'Correct' : 'Not quite'}</Text>
          </View>
          {!correct ? <Text style={styles.wrong}>You chose: {reviewing.feedback.selectedOptionText}</Text> : null}
          <Text style={styles.right}>Correct: {reviewing.feedback.correctOptionText}</Text>
          <Text style={styles.missExplain}>{reviewing.feedback.explanation}</Text>
          {!correct && reviewing.feedback.hook ? <View style={styles.hook}><Feather name="zap" size={14} color={DARK.hookText} /><Text style={styles.hookText}>{reviewing.feedback.hook}</Text></View> : null}
          {reportNote(reviewing)}
        </View>
        {progress}
        <Pressable accessibilityRole="button" onPress={() => setReviewingId(null)} style={styles.primaryButton} testID="button-quiz-next">
          <Text style={styles.primaryText}>{answered.length >= questions.length ? 'See the score' : 'Next question'}</Text>
        </Pressable>
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
            <Text style={[styles.bubbleText, answered && styles.bubbleTextAnswered]}>{i + 1}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  const current: StudyQuizQuestionsItem | undefined = (isExam && currentId ? questions.find((q) => q.id === currentId) : undefined) ?? questions.find((q) => !q.answer);
  if (!current) {
    return (
      <View style={styles.card} testID="panel-quiz-grade">
        <Text style={styles.kicker}>{kindLabel.toUpperCase()} · {session.topic}</Text>
        <Text style={styles.cardTitle}>All {questions.length} answered.</Text>
        {bubbles}
        {marked.length ? <Text style={styles.muted}>{marked.length} marked for review. Tap a red bubble to go back to it, or grade now.</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
          try {
            const graded = await grade.mutateAsync({ id: sessionId });
            queryClient.setQueryData(key, graded);
            onGraded(graded);
          } catch (problem) { onError(problem); }
        }} style={[styles.primaryButton, busy && styles.disabled]} testID="button-quiz-grade">
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={styles.primaryText}>Grade</Text>}
        </Pressable>
      </View>
    );
  }

  const choose = async (optionId: string) => {
    if (busy) return;
    try {
      const updated = await saveAnswer.mutateAsync({ id: sessionId, data: { questionId: current.id, optionId, assisted: false } });
      queryClient.setQueryData(key, updated);
      if (quiz.kind === 'practice') { setReviewingId(current.id); return; }
      // Exam: move on to the next unanswered question after this one (wrapping), else the "all answered" panel.
      const list = (updated.quiz?.questions ?? []).filter(counts);
      const at = list.findIndex((q) => q.id === current.id);
      const next = [...list.slice(at + 1), ...list.slice(0, at)].find((q) => !q.answer);
      setCurrentId(next?.id ?? null);
    } catch (problem) { onError(problem); }
  };

  const chosen = isExam ? current.answer?.optionId ?? null : null;
  return (
    <View style={styles.card} testID="panel-quiz-question">
      <Text style={styles.kicker}>{kindLabel.toUpperCase()} · QUESTION {questions.indexOf(current) + 1} OF {questions.length}</Text>
      {progress}
      {bubbles}
      <Text style={styles.prompt}>{current.prompt}</Text>
      {current.options.map((option, i) => (
        <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: chosen === option.id }} disabled={busy} onPress={() => void choose(option.id)}
          style={({ pressed }) => [styles.option, chosen === option.id && styles.optionChosen, pressed && styles.pressed, busy && styles.disabled]} testID={`button-quiz-option-${i}`}>
          <Text style={[styles.optionLetter, chosen === option.id && styles.optionLetterChosen]}>{'ABCDE'[i]}</Text>
          <Text style={styles.optionText}>{option.text}</Text>
        </Pressable>
      ))}
      {isExam ? (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: marks.has(current.id) }} onPress={() => toggleMark(current.id)} style={[styles.markButton, marks.has(current.id) && styles.markButtonOn]} testID="button-quiz-mark">
          <Feather name="flag" size={15} color={marks.has(current.id) ? EXAM.marked : colors.foreground} />
          <Text style={[styles.markText, marks.has(current.id) && { color: EXAM.marked }]}>{marks.has(current.id) ? 'Marked for review' : 'Mark for review'}</Text>
        </Pressable>
      ) : null}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
    </View>
  );
}

// Review bubbles are dark on purpose (Dan, 2026-10-06): black background, white text,
// red for the student's wrong answer, green for the correct one. Fixed palette for now;
// becomes theme tokens in the aesthetics pass.
const DARK = { bg: '#101418', text: '#eef2f6', muted: '#aab6c3', wrong: '#ff6b61', right: '#4cd964', hookBg: '#1f2f4f', hookText: '#b9d0ff' };
// Exam bubbles (D-037, Dan): white outline = unanswered, green = answered, red = marked for review.
const EXAM = { answered: '#2f9e5b', marked: '#d6453a', open: '#ffffff' };

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 10 },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' },
  prompt: { color: colors.foreground, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  progress: { gap: 4 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.secondary, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: colors.primary },
  progressText: { color: colors.mutedForeground, fontSize: 11 },
  hook: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, backgroundColor: DARK.hookBg },
  hookText: { flex: 1, color: DARK.hookText, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  cardTitle: { color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.background, paddingHorizontal: 13, paddingVertical: 10 },
  optionChosen: { borderColor: colors.primary, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 9 },
  optionLetterChosen: { backgroundColor: colors.primary, color: colors.primaryForeground },
  // 28 pt + 6 pt gaps: ten per row on an iPhone, so twenty questions take two rows (Dan). hitSlop keeps the touch target at 44 pt.
  bubbles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  bubble: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: EXAM.open, alignItems: 'center', justifyContent: 'center' },
  bubbleAnswered: { borderColor: EXAM.answered, backgroundColor: EXAM.answered }, // fill = answered
  bubbleMarked: { borderColor: EXAM.marked }, // ring = marked, whether answered or not
  bubbleHere: { transform: [{ scale: 1.18 }] },
  bubbleText: { color: colors.foreground, fontSize: 12, fontWeight: '700' },
  bubbleTextAnswered: { color: '#ffffff' },
  markButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  markButtonOn: { borderColor: EXAM.marked },
  markText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  optionLetter: { width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, overflow: 'hidden', backgroundColor: colors.secondary, color: colors.foreground, fontWeight: '700', fontSize: 13 },
  optionText: { flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 20 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictText: { fontSize: 16, fontWeight: '700' },
  // Review card type (Dan, 2026-10-08: "the fonts need to be smaller here"): one step down across the card.
  wrong: { color: DARK.wrong, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  right: { color: DARK.right, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  miss: { gap: 7, padding: 13, borderRadius: 16, backgroundColor: DARK.bg },
  missPrompt: { color: DARK.text, fontSize: 14.5, lineHeight: 20, fontWeight: '600' },
  missExplain: { color: DARK.muted, fontSize: 13, lineHeight: 18.5 },
  // Report link: small and away from the main button on purpose (UX_PRINCIPLES: destructive-ish actions are small and separated).
  reportLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  reportLinkText: { color: DARK.muted, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.card },
  noteText: { flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 },
  noteStrong: { fontWeight: '700' },
  score: { color: colors.primary, fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryText: { color: colors.primaryForeground, fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
