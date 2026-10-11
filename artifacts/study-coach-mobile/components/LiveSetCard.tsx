import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer,
  type StudyQuestionFlagInputKind, type StudySession, type StudyQuizQuestionsItem,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Bone, SkeletonGroup } from '@/components/Skeleton';
import { FONT, TYPE } from '@/constants/type';
import { conceptTallies, rowResult, scoreLine } from '@/lib/live-set';

/**
 * A practice set as one live card in the chat (D-051/D-053, Dan: "one live card at a time").
 * It sits under the coach message that started the set and stays there as the thread's
 * history. One question is live at a time: tap an option, the verdict, explanation and
 * memory trick land under it, Next brings the following question; answered questions
 * collapse to one line each above the live one (tap to reopen). While the rest of a
 * two-part set is still being written (D-052) the card polls and shows a skeleton for the
 * next question. Grade is offered when every question is in and answered; the score, a
 * line, and per-concept bars close the card. "Looks wrong?" (D-034) stays on every
 * answered question. Exam sets keep the full-screen sheet (components/QuizCard.tsx).
 */
export function LiveSetCard({ sessionId, userId, onGraded, onError, onStepChange }: {
  sessionId: string;
  userId: string | null | undefined;
  /** Called once when the student taps Grade and the server has graded the set. */
  onGraded: (session: StudySession) => void;
  onError: (problem: unknown) => void;
  /** Fires with the live block's height whenever what it shows changes (next question, feedback, score), so the chat can scroll it to the top. */
  onStepChange?: (step: string, liveHeight: number) => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const key = [...getGetStudySessionQueryKey(sessionId), userId];
  // Polled while the rest of a two-part set is on its way (D-052).
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key, enabled: !!userId, refetchInterval: (query) => (query.state.data?.quiz?.status === 'writing' ? 1500 : false) } });
  const saveAnswer = useSaveStudyAnswer();
  const grade = useGradeStudyQuiz();
  const flag = useFlagStudyQuestion();
  const [reviewingId, setReviewingId] = useState<string | null>(null); // the question whose feedback is live
  const [expandedId, setExpandedId] = useState<string | null>(null); // a collapsed row opened again
  const [reportingId, setReportingId] = useState<string | null>(null);
  const reportedStep = useRef<string | null>(null);

  const session = sessionQuery.data;
  const quiz = session?.quiz ?? null;
  const busy = saveAnswer.isPending || grade.isPending;
  const counts = (q: StudyQuizQuestionsItem) => !q.flag || q.flag.recheck?.verdict === 'key_holds';

  const liveLayout = (step: string) => (e: LayoutChangeEvent) => {
    if (reportedStep.current === step) return;
    reportedStep.current = step;
    onStepChange?.(step, e.nativeEvent.layout.height);
  };

  if (sessionQuery.isLoading || (!session && sessionQuery.isFetching)) {
    return (
      <View style={styles.card} testID="card-live-set-loading">
        <QuestionSkeleton caption="Loading your questions…" />
      </View>
    );
  }
  if (!session || !quiz) {
    return (
      <View style={styles.card} testID="card-live-set-error">
        <Text style={styles.muted}>Couldn’t load this set.</Text>
        <Pressable accessibilityRole="button" onPress={() => void sessionQuery.refetch()} style={styles.secondaryButton} testID="button-retry-live-set"><Text style={styles.secondaryText}>Retry</Text></Pressable>
      </View>
    );
  }

  const questions = quiz.questions.filter(counts);
  const answered = questions.filter((q) => q.answer);
  const writing = quiz.status === 'writing';
  const total = writing ? Math.max(quiz.expectedCount, questions.length) : questions.length;
  const reviewing = reviewingId ? quiz.questions.find((q) => q.id === reviewingId) : undefined;
  const current = questions.find((q) => !q.answer);
  const step = quiz.grade ? 'score' : reviewing?.feedback ? `feedback:${reviewing.id}` : current ? `question:${current.id}` : writing ? `writing:${questions.length}` : 'grade';

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
    if (reportingId === question.id) return <View style={styles.note} testID="status-recheck"><ActivityIndicator color={colors.primaryText} size="small" /><Text style={styles.noteText}>Checking the answer again…</Text></View>;
    const recheck = question.flag?.recheck;
    if (question.flag && !recheck) return <View style={styles.note} testID="note-recheck"><Feather name="flag" size={14} color={colors.mutedForeground} /><Text style={styles.noteText}>Reported. This question won’t count.</Text></View>;
    if (recheck) {
      const youWereRight = recheck.verdict === 'key_wrong' && !!question.answer && recheck.correctOptionId === question.answer.optionId;
      const headline = recheck.verdict === 'key_holds' ? 'Checked again: the answer key holds.'
        : recheck.verdict === 'key_wrong' ? (youWereRight ? `You’re right. The correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count against you.` : `The answer key was wrong: the correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count.`)
        : 'This question is unclear, so it won’t count.';
      return (
        <View style={styles.note} testID={`note-recheck-${recheck.verdict}`}>
          <Feather name={recheck.verdict === 'key_holds' ? 'check-circle' : 'alert-circle'} size={14} color={recheck.verdict === 'key_holds' ? colors.mutedForeground : colors.primaryText} />
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

  // The question with its options; after an answer the chosen and the correct options are marked.
  const questionBlock = (question: StudyQuizQuestionsItem, position: number, answerable: boolean) => {
    const feedback = question.feedback ?? null;
    return (
      <View style={styles.question}>
        <Text style={styles.kicker}>Question {position + 1} of {total}{question.concept ? ` · ${question.concept}` : ''}</Text>
        <Text style={styles.prompt}>{question.prompt}</Text>
        {question.options.map((option, i) => {
          const chosen = feedback ? feedback.selectedOptionId === option.id : false;
          const correct = feedback ? feedback.correctOptionId === option.id : false;
          const mark = correct ? 'correct' : chosen ? 'wrong' : null;
          return (
            <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: !answerable }} disabled={!answerable || busy}
              onPress={() => void choose(question, option.id)}
              style={({ pressed }) => [styles.option, mark === 'correct' && styles.optionCorrect, mark === 'wrong' && styles.optionWrong, pressed && answerable && styles.pressed, busy && answerable && styles.disabled]}
              testID={`button-live-option-${i}`}>
              <Text style={[styles.optionLetter, mark === 'correct' && styles.optionLetterCorrect, mark === 'wrong' && styles.optionLetterWrong]}>{'ABCDE'[i]}</Text>
              <Text style={[styles.optionText, mark && styles.optionTextMarked]}>{option.text}</Text>
              {mark ? <Feather name={mark === 'correct' ? 'check' : 'x'} size={18} color={mark === 'correct' ? colors.correct : colors.wrong} /> : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  // Verdict, explanation and memory trick under an answered question.
  const feedbackBlock = (question: StudyQuizQuestionsItem) => {
    const feedback = question.feedback;
    if (!feedback) return null;
    const correct = feedback.selectedOptionId === feedback.correctOptionId;
    return (
      <View style={styles.feedback}>
        <View style={styles.verdict}>
          <Feather name={correct ? 'check-circle' : 'x-circle'} size={20} color={correct ? colors.correct : colors.wrong} />
          <Text style={[styles.verdictText, { color: correct ? colors.correct : colors.wrong }]}>{correct ? 'Correct' : 'Not quite'}</Text>
        </View>
        <Text style={styles.body}>{feedback.explanation}</Text>
        {feedback.hook ? <View style={styles.hook}><Feather name="zap" size={15} color={colors.hookText} /><Text style={styles.hookText}>{feedback.hook}</Text></View> : null}
        {reportNote(question)}
      </View>
    );
  };

  const choose = async (question: StudyQuizQuestionsItem, optionId: string) => {
    if (busy) return;
    try {
      const updated = await saveAnswer.mutateAsync({ id: sessionId, data: { questionId: question.id, optionId, assisted: false } });
      queryClient.setQueryData(key, updated);
      setReviewingId(question.id);
    } catch (problem) { onError(problem); }
  };

  const gradeSet = async () => {
    try {
      const graded = await grade.mutateAsync({ id: sessionId });
      queryClient.setQueryData(key, graded);
      onGraded(graded);
    } catch (problem) { onError(problem); }
  };

  // Answered questions, one line each, above the live block; the one being reviewed stays live.
  const collapsed = answered.filter((q) => q.id !== reviewingId || !!quiz.grade);
  const rows = collapsed.length ? (
    <View style={styles.rows} testID="rows-live-set">
      {collapsed.map((q) => {
        const result = rowResult(q);
        const open = expandedId === q.id;
        const position = questions.indexOf(q);
        return (
          <Animated.View key={q.id} entering={FadeIn.duration(220)} layout={LinearTransition.duration(220)}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Question ${position + 1}, ${result === 'correct' ? 'correct' : result === 'wrong' ? 'missed' : 'answered'}: ${q.concept}`}
              onPress={() => setExpandedId(open ? null : q.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`row-live-${position}`}>
              <Text style={styles.rowNumber}>{position + 1}</Text>
              <Feather name={result === 'correct' ? 'check-circle' : result === 'wrong' ? 'x-circle' : 'circle'} size={16} color={result === 'correct' ? colors.correct : result === 'wrong' ? colors.wrong : colors.mutedForeground} />
              <Text numberOfLines={open ? undefined : 1} style={styles.rowText}>{q.concept || q.prompt}</Text>
              <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
            </Pressable>
            {open ? <View style={styles.rowOpen}>{questionBlock(q, position, false)}{feedbackBlock(q)}</View> : null}
          </Animated.View>
        );
      })}
    </View>
  ) : null;

  let live: React.ReactNode;
  if (quiz.grade) {
    const percent = quiz.grade.percent;
    const tallies = conceptTallies(quiz.questions.filter(counts));
    live = (
      <Animated.View entering={FadeInUp.duration(320)} style={styles.live} onLayout={liveLayout(step)} testID="panel-live-score">
        <Text style={styles.score}><Text style={styles.scoreBig}>{quiz.grade.correct}</Text><Text style={styles.scoreOf}>/{quiz.grade.answered}</Text></Text>
        <Text style={styles.body}>{scoreLine(percent)}</Text>
        <Text style={styles.small}>{percent}% on the questions you answered{quiz.grade.unanswered ? ` · ${quiz.grade.unanswered} skipped` : ''}.</Text>
        {tallies.length > 1 ? (
          <View style={styles.tallies} testID="panel-live-tallies">
            {tallies.map((t) => (
              <View key={t.concept} style={styles.tally} accessible accessibilityLabel={`${t.concept}: ${t.correct} of ${t.total}`}>
                <View style={styles.tallyHead}><Text numberOfLines={1} style={styles.tallyName}>{t.concept}</Text><Text style={styles.tallyCount}>{t.correct}/{t.total}</Text></View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round((t.correct / t.total) * 100)}%` }, t.correct < t.total && styles.progressFillPartial]} /></View>
              </View>
            ))}
          </View>
        ) : null}
      </Animated.View>
    );
  } else if (reviewing?.feedback) {
    // A reported question drops out of `questions`; its place in the set still reads from the full list.
    const position = questions.includes(reviewing) ? questions.indexOf(reviewing) : quiz.questions.indexOf(reviewing);
    // The last answer of a complete set: one tap grades (no separate "all answered" stop).
    const last = answered.length >= questions.length && !writing;
    live = (
      <View style={styles.live} onLayout={liveLayout(step)} testID="panel-live-feedback">
        {questionBlock(reviewing, position, false)}
        <Animated.View entering={FadeInUp.duration(280)}>{feedbackBlock(reviewing)}</Animated.View>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { if (last) void gradeSet(); else setReviewingId(null); }} style={[styles.primaryButton, busy && styles.disabled]} testID="button-live-next">
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <><Text style={styles.primaryText}>{last ? 'See the score' : 'Next question'}</Text><Feather name="arrow-right" size={18} color={colors.primaryForeground} /></>}
        </Pressable>
      </View>
    );
  } else if (current) {
    live = (
      <Animated.View key={current.id} entering={FadeInUp.duration(280)} style={styles.live} onLayout={liveLayout(step)} testID="panel-live-question">
        {questionBlock(current, questions.indexOf(current), true)}
        {busy ? <ActivityIndicator color={colors.primaryText} /> : null}
      </Animated.View>
    );
  } else if (writing) {
    live = (
      <View style={styles.live} onLayout={liveLayout(step)} testID="panel-live-writing">
        <QuestionSkeleton caption={`Writing question ${questions.length + 1}…`} />
      </View>
    );
  } else {
    live = (
      <View style={styles.live} onLayout={liveLayout(step)} testID="panel-live-grade">
        <Text style={styles.heading}>All {questions.length} answered.</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void gradeSet()} style={[styles.primaryButton, busy && styles.disabled]} testID="button-live-grade">
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <><Text style={styles.primaryText}>Grade</Text><Feather name="arrow-right" size={18} color={colors.primaryForeground} /></>}
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.card} testID="card-live-set">
      <View style={styles.head}>
        <Text style={styles.kicker}>Practice · {session.topic}</Text>
        {!quiz.grade ? <Text style={styles.headCount} accessibilityLabel={`${answered.length} of ${total} answered`}>{answered.length}/{total}</Text> : null}
      </View>
      {!quiz.grade ? (
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: answered.length }}>
          <View style={[styles.progressFill, { width: `${total ? Math.round((answered.length / total) * 100) : 0}%` }]} />
        </View>
      ) : null}
      {rows}
      {live}
    </Animated.View>
  );
}

/** Gray shapes in the shape of a question (kicker, two lines of prompt, four options) with one caption. */
function QuestionSkeleton({ caption }: { caption: string }) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.skeletonWrap}>
      <SkeletonGroup style={styles.skeleton} testID="skeleton-live-question">
        <Bone width={120} height={12} />
        <Bone width="94%" height={18} />
        <Bone width="70%" height={18} />
        {[0, 1, 2, 3].map((i) => <Bone key={i} height={52} radius={14} style={i === 0 ? styles.skeletonFirstOption : undefined} />)}
      </SkeletonGroup>
      <View style={styles.note}><ActivityIndicator color={colors.primaryText} size="small" /><Text style={styles.noteText}>{caption}</Text></View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { marginTop: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kicker: { ...TYPE.kicker, color: colors.mutedForeground, flexShrink: 1 },
  headCount: { ...TYPE.small, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.secondary, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: colors.primary },
  progressFillPartial: { backgroundColor: colors.primaryText },
  rows: { gap: 2 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowNumber: { ...TYPE.small, width: 22, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  rowText: { ...TYPE.small, flex: 1, color: colors.foreground },
  rowOpen: { gap: 12, paddingBottom: 10 },
  live: { gap: 14 },
  question: { gap: 10 },
  prompt: { ...TYPE.prompt, color: colors.foreground },
  option: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.background, paddingHorizontal: 14, paddingVertical: 12 },
  optionCorrect: { borderColor: colors.correct, borderWidth: 2, paddingHorizontal: 13, paddingVertical: 11 },
  optionWrong: { borderColor: colors.wrong, borderWidth: 2, paddingHorizontal: 13, paddingVertical: 11 },
  optionLetter: { ...TYPE.letter, width: 28, height: 28, borderRadius: 14, textAlign: 'center', overflow: 'hidden', backgroundColor: colors.secondary, color: colors.foreground },
  optionLetterCorrect: { backgroundColor: colors.correct, color: '#ffffff' },
  optionLetterWrong: { backgroundColor: colors.wrong, color: '#ffffff' },
  optionText: { ...TYPE.option, flex: 1, color: colors.foreground },
  optionTextMarked: { fontFamily: FONT.sansSemi },
  feedback: { gap: 10 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictText: { ...TYPE.bodySemi },
  body: { ...TYPE.body, color: colors.foreground },
  small: { ...TYPE.small, color: colors.mutedForeground },
  muted: { ...TYPE.small, color: colors.mutedForeground },
  hook: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 14, backgroundColor: colors.hookBg },
  hookText: { ...TYPE.smallSemi, flex: 1, color: colors.hookText },
  heading: { ...TYPE.heading, color: colors.foreground },
  score: { color: colors.foreground },
  scoreBig: { ...TYPE.score, color: colors.foreground },
  scoreOf: { ...TYPE.scoreOf, color: colors.mutedForeground },
  tallies: { gap: 10, paddingTop: 4 },
  tally: { gap: 6 },
  tallyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tallyName: { ...TYPE.small, flex: 1, color: colors.foreground },
  tallyCount: { ...TYPE.small, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  // Report link: small and away from the main button on purpose (UX_PRINCIPLES: destructive-ish actions are small and separated).
  reportLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  reportLinkText: { ...TYPE.smallSemi, color: colors.mutedForeground, textDecorationLine: 'underline' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.background },
  noteText: { ...TYPE.small, flex: 1, color: colors.foreground },
  noteStrong: { fontFamily: FONT.sansSemi },
  primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryText: { ...TYPE.button, color: colors.primaryForeground },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { ...TYPE.smallSemi, color: colors.foreground },
  skeletonWrap: { gap: 12 },
  skeleton: { gap: 10 },
  skeletonFirstOption: { marginTop: 6 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
