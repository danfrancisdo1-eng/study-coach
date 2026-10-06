import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudySessionQueryKey, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer,
  type StudySession, type StudyQuizQuestionsItem,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

/**
 * One question at a time inside the chat (SPEC §6 steps 4–5). Practice sets show the
 * correct answer and why right after each tap; exam sets only after Grade. Answers are
 * saved on the server as they are tapped, so leaving and coming back resumes.
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
  const [reviewingId, setReviewingId] = useState<string | null>(null); // practice: the question whose feedback is on screen
  const session = sessionQuery.data;
  const quiz = session?.quiz ?? null;
  const busy = saveAnswer.isPending || grade.isPending;
  const step = !quiz ? 'loading' : quiz.grade ? 'score' : reviewingId ? `feedback:${reviewingId}` : `question:${quiz.questions.find((q) => !q.flag && !q.answer)?.id ?? 'grade'}`;
  useEffect(() => { onStepChange?.(step); }, [step]);

  if (sessionQuery.isLoading) return <View style={styles.card}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading your questions…</Text></View>;
  if (!session || !quiz) {
    return <View style={styles.card}><Text style={styles.muted}>Couldn’t load this set.</Text>
      <Pressable accessibilityRole="button" onPress={() => void sessionQuery.refetch()} style={styles.secondaryButton} testID="button-retry-quiz"><Text style={styles.secondaryText}>Retry</Text></Pressable></View>;
  }

  const questions = quiz.questions.filter((q) => !q.flag);
  const answered = questions.filter((q) => q.answer);
  const kindLabel = quiz.kind === 'practice' ? 'Practice' : 'Exam';
  const progress = (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: questions.length, now: answered.length }}>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${questions.length ? Math.round((answered.length / questions.length) * 100) : 0}%` }]} /></View>
      <Text style={styles.progressText}>{answered.length} of {questions.length} answered</Text>
    </View>
  );

  if (quiz.grade) {
    const misses = questions.filter((q) => q.feedback && q.feedback.selectedOptionId && q.feedback.selectedOptionId !== q.feedback.correctOptionId);
    return (
      <View style={styles.card} testID="panel-quiz-score">
        <Text style={styles.kicker}>{kindLabel.toUpperCase()} · {session.topic}</Text>
        <Text style={styles.score}>{quiz.grade.correct} / {quiz.grade.answered}</Text>
        <Text style={styles.body}>{quiz.grade.percent}% on the questions you answered{quiz.grade.unanswered ? ` · ${quiz.grade.unanswered} skipped` : ''}.</Text>
        {misses.length ? <Text style={styles.cardTitle}>What you missed</Text> : <Text style={styles.cardTitle}>Nothing missed. Nice.</Text>}
        {misses.map((q, i) => (
          <View key={q.id} style={styles.miss} testID={`quiz-miss-${i}`}>
            <Text style={styles.body}>{q.prompt}</Text>
            <Text style={styles.wrong}>You chose: {q.feedback!.selectedOptionText}</Text>
            <Text style={styles.right}>Correct: {q.feedback!.correctOptionText}</Text>
            <Text style={styles.muted}>{q.feedback!.explanation}</Text>
            {q.feedback!.hook ? <View style={styles.hook}><Feather name="zap" size={14} color={colors.foreground} /><Text style={styles.hookText}>{q.feedback!.hook}</Text></View> : null}
          </View>
        ))}
      </View>
    );
  }

  const reviewing = reviewingId ? questions.find((q) => q.id === reviewingId) : undefined;
  if (reviewing?.feedback) {
    const correct = reviewing.feedback.selectedOptionId === reviewing.feedback.correctOptionId;
    return (
      <View style={styles.card} testID="panel-quiz-feedback">
        <Text style={styles.kicker}>{kindLabel.toUpperCase()} · QUESTION {questions.indexOf(reviewing) + 1} OF {questions.length}</Text>
        <Text style={styles.body}>{reviewing.prompt}</Text>
        <View style={[styles.verdict, { backgroundColor: correct ? colors.accent : colors.secondary }]}>
          <Feather name={correct ? 'check-circle' : 'x-circle'} size={18} color={colors.foreground} />
          <Text style={styles.cardTitle}>{correct ? 'Correct' : 'Not quite'}</Text>
        </View>
        {!correct ? <Text style={styles.wrong}>You chose: {reviewing.feedback.selectedOptionText}</Text> : null}
        <Text style={styles.right}>Correct: {reviewing.feedback.correctOptionText}</Text>
        <Text style={styles.muted}>{reviewing.feedback.explanation}</Text>
        {!correct && reviewing.feedback.hook ? <View style={styles.hook}><Feather name="zap" size={14} color={colors.foreground} /><Text style={styles.hookText}>{reviewing.feedback.hook}</Text></View> : null}
        {progress}
        <Pressable accessibilityRole="button" onPress={() => setReviewingId(null)} style={styles.primaryButton} testID="button-quiz-next">
          <Text style={styles.primaryText}>{answered.length >= questions.length ? 'See the score' : 'Next question'}</Text>
        </Pressable>
      </View>
    );
  }

  const current: StudyQuizQuestionsItem | undefined = questions.find((q) => !q.answer);
  if (!current) {
    return (
      <View style={styles.card} testID="panel-quiz-grade">
        <Text style={styles.kicker}>{kindLabel.toUpperCase()} · {session.topic}</Text>
        <Text style={styles.cardTitle}>All {questions.length} answered.</Text>
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
      if (quiz.kind === 'practice') setReviewingId(current.id);
    } catch (problem) { onError(problem); }
  };

  return (
    <View style={styles.card} testID="panel-quiz-question">
      <Text style={styles.kicker}>{kindLabel.toUpperCase()} · QUESTION {questions.indexOf(current) + 1} OF {questions.length}</Text>
      {progress}
      <Text style={styles.prompt}>{current.prompt}</Text>
      {current.options.map((option, i) => (
        <Pressable key={option.id} accessibilityRole="button" disabled={busy} onPress={() => void choose(option.id)}
          style={({ pressed }) => [styles.option, pressed && styles.pressed, busy && styles.disabled]} testID={`button-quiz-option-${i}`}>
          <Text style={styles.optionLetter}>{'ABCD'[i]}</Text>
          <Text style={styles.optionText}>{option.text}</Text>
        </Pressable>
      ))}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 10 },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' },
  prompt: { color: colors.foreground, fontSize: 16, lineHeight: 24, fontWeight: '500' },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  progress: { gap: 4 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.secondary, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: colors.primary },
  progressText: { color: colors.mutedForeground, fontSize: 11 },
  hook: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.secondary },
  hookText: { flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  cardTitle: { color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.background, paddingHorizontal: 13, paddingVertical: 10 },
  optionLetter: { width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, overflow: 'hidden', backgroundColor: colors.secondary, color: colors.foreground, fontWeight: '700', fontSize: 13 },
  optionText: { flex: 1, color: colors.foreground, fontSize: 14.5, lineHeight: 21 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12 },
  wrong: { color: colors.destructive, fontSize: 14, lineHeight: 20 },
  right: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  miss: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  score: { color: colors.primary, fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryText: { color: colors.primaryForeground, fontSize: 16, fontWeight: '700' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
