import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInUp, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { PRESS_SCALE, PressScale } from '@/components/PressScale';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer,
  type StudyQuestionFlagInputKind, type StudySession, type StudyQuizQuestionsItem,
} from '@workspace/api-client-react';
import { Confetti } from '@/components/Confetti';
import { GlassFill, glassBorder } from '@/components/GlassFill';
import { AnswerMark } from '@/components/AnswerMark';
import { useAnswerSounds } from '@/hooks/useAnswerSounds';
import { answerKind, shouldPlayAnswerSound, shouldShowAnswerMark } from '@/lib/answer-feedback';
import { feedbackHaptic, playFeedbackSound, prepareFeedbackSounds } from '@/lib/feedback-sounds';
import { isPerfect } from '@/lib/perfect-score';
import { useColors } from '@/hooks/useColors';
import { Bone, SkeletonGroup } from '@/components/Skeleton';
import { ProgressBar } from '@/components/ProgressBar';
import { StatRow } from '@/components/StatRow';
import { masteryIsStrong, masteryLabel, masteryShare, masteryValue } from '@/lib/mastery';
import { barDelayMs, rowDelayMs } from '@/lib/count-up';
import { useCountUp } from '@/hooks/useCountUp';
import { writtenProgress } from '@/lib/progress';
import { FONT, TYPE } from '@/constants/type';
import { topicParts } from '@/lib/topic-label';
import { rowResult, scoreLine, sectionTallies } from '@/lib/live-set';

/**
 * A practice set as one live card in the chat (D-051/D-053, Dan: "one live card at a time").
 * It sits under the coach message that started the set and stays there as the thread's
 * history. One question is live at a time: tap an option, the verdict, explanation and
 * memory trick land under it, Next brings the following question. After grading, the score
 * with bars per exam section, then the review: every question as one line (tap to reopen).
 * While the rest of a
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
  const [justAnsweredId, setJustAnsweredId] = useState<string | null>(null); // D-172: the answer whose mark is rising
  const reportedStep = useRef<string | null>(null);
  const answerSounds = useAnswerSounds();
  useEffect(() => { void prepareFeedbackSounds(); }, []); // D-172: both clips ready before the first answer

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
        <CardText style={styles.muted}>Couldn’t load this set.</CardText>
        <Pressable accessibilityRole="button" onPress={() => void sessionQuery.refetch()} style={styles.secondaryButton} testID="button-retry-live-set"><CardText style={styles.secondaryText}>Retry</CardText></Pressable>
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

  // The question with its options; after an answer the chosen and the correct options are marked.
  const questionBlock = (question: StudyQuizQuestionsItem, position: number, answerable: boolean) => {
    const feedback = question.feedback ?? null;
    return (
      <View style={styles.question}>
        <CardText style={styles.kicker}>Question {position + 1} of {total}{question.concept ? ` · ${question.concept}` : ''}</CardText>
        <CardText style={styles.prompt}>{question.prompt}</CardText>
        {question.options.map((option, i) => {
          const chosen = feedback ? feedback.selectedOptionId === option.id : false;
          const correct = feedback ? feedback.correctOptionId === option.id : false;
          const mark = correct ? 'correct' : chosen ? 'wrong' : null;
          return (
            <PressScale key={option.id} scale={PRESS_SCALE.card} haptic={false} accessibilityRole="button" accessibilityLabel={`${'ABCDE'[i]}. ${option.text}${mark === 'correct' ? ', correct answer' : mark === 'wrong' ? ', your answer, wrong' : ''}`} accessibilityState={{ selected: chosen, disabled: !answerable }} disabled={!answerable || busy}
              onPress={() => void choose(question, option.id)}
              style={[styles.option, mark === 'correct' && styles.optionCorrect, mark === 'wrong' && styles.optionWrong, busy && answerable && styles.disabled]}
              testID={`button-live-option-${i}`}>
              {mark ? (
                <View style={[styles.optionMark, mark === 'correct' ? styles.optionMarkRight : styles.optionMarkWrong]}><Feather name={mark === 'correct' ? 'check' : 'x'} size={16} color="#ffffff" /></View>
              ) : (
                <CardText style={styles.optionLetter}>{'ABCDE'[i]}</CardText>
              )}
              <CardText style={[styles.optionText, mark && styles.optionTextMarked, mark === 'correct' && { color: colors.correct }, mark === 'wrong' && { color: colors.wrong }]}>
                {option.text}
                {/* D-172: the rising mark after the last letter of the answer just tapped. */}
                {chosen && mark && justAnsweredId === question.id ? <AnswerMark kind={mark} lineHeight={TYPE.option.lineHeight} /> : null}
              </CardText>
            </PressScale>
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
        {/* Grok's feedback layout (Dan: "match it", D-063): a tinted panel headed by the verdict, then the trick as its own card. */}
        <View style={[styles.verdictPanel, correct ? styles.verdictPanelRight : styles.verdictPanelWrong]} testID={correct ? 'panel-verdict-right' : 'panel-verdict-wrong'}>
          <CardText style={[styles.verdictTitle, { color: correct ? colors.correct : colors.wrong }]}>{correct ? 'Correct' : 'Not this one'}</CardText>
          <CardText style={styles.body}>{feedback.explanation}</CardText>
        </View>
        {feedback.hook ? (
          <View style={styles.hook}>
            <View style={styles.hookHead}><Feather name="zap" size={14} color={colors.hookText} /><CardText style={styles.hookKicker}>Remember it</CardText></View>
            <CardText style={styles.hookText}>{feedback.hook}</CardText>
          </View>
        ) : null}
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
      // D-172: the verdict lands with a mark, a haptic and (untimed, switched on) a sound.
      const kind = answerKind(updated.quiz?.questions.find((q) => q.id === question.id)?.feedback);
      const timed = !!updated.quiz?.timer;
      if (kind && shouldShowAnswerMark({ timed })) {
        setJustAnsweredId(question.id);
        feedbackHaptic(kind);
        if (shouldPlayAnswerSound({ enabled: answerSounds.enabled, timed })) void playFeedbackSound(kind);
      }
    } catch (problem) { onError(problem); }
  };

  const gradeSet = async () => {
    try {
      const graded = await grade.mutateAsync({ id: sessionId });
      queryClient.setQueryData(key, graded);
      onGraded(graded);
    } catch (problem) { onError(problem); }
  };

  // The review (D-059): after grading, every answered question as one line, under the score; tap to reopen one.
  const collapsed = quiz.grade ? answered : [];
  const rows = collapsed.length ? (
    <View style={styles.rows} testID="rows-live-set">
      <CardText style={styles.kicker}>Review</CardText>
      {collapsed.map((q) => {
        const result = rowResult(q);
        const open = expandedId === q.id;
        const position = questions.indexOf(q);
        return (
          <Animated.View key={q.id} entering={FadeIn.duration(220).delay(rowDelayMs(collapsed.indexOf(q)))} layout={LinearTransition.duration(220)}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Question ${position + 1}, ${result === 'correct' ? 'correct' : result === 'wrong' ? 'missed' : 'answered'}: ${q.concept}`}
              onPress={() => setExpandedId(open ? null : q.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`row-live-${position}`}>
              <CardText style={styles.rowNumber}>{position + 1}</CardText>
              {/* D-171: a plain mark; ten red circles in a column read as punishment. The row's label still says correct or missed. */}
              <Feather name={result === 'correct' ? 'check' : result === 'wrong' ? 'x' : 'minus'} size={16} color={result === 'correct' ? colors.correct : result === 'wrong' ? colors.wrong : colors.mutedForeground} />
              <CardText numberOfLines={open ? undefined : 1} style={styles.rowText}>{q.concept || q.prompt}</CardText>
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
    const tallies = sectionTallies(quiz.questions.filter(counts));
    live = (
      <Animated.View entering={FadeInUp.duration(320)} style={styles.live} onLayout={liveLayout(step)} testID="panel-live-score">
        <Confetti sessionId={sessionId} perfect={isPerfect(quiz.grade)} />
        {/* D-179: the score pops in and counts up; VoiceOver reads the final number only. */}
        <ScoreCountUp correct={quiz.grade.correct} answered={quiz.grade.answered} bigStyle={styles.scoreBig} ofStyle={styles.scoreOf} style={styles.score} />
        <CardText style={styles.body}>{scoreLine(percent)}</CardText>
        {/* Review finding 14 (D-087): the big score already says it; only skipped questions need a line. */}
        {quiz.grade.unanswered ? <CardText style={styles.small}>{quiz.grade.unanswered} skipped.</CardText> : null}
        {tallies.length ? (
          <View style={styles.tallies} testID="panel-live-tallies">
            <View style={styles.tallyHead}><CardText style={styles.kicker}>By section</CardText><CardText style={styles.kicker}>right / asked</CardText></View>
            {/* D-167: one line per section, the count in a fixed column so the numbers line up. */}
            {tallies.map((t, i) => (
              <StatRow key={t.concept} label={t.concept} value={masteryValue(t.correct, t.total)} fraction={masteryShare(t.correct, t.total)} fillColor={masteryIsStrong(t.correct, t.total) ? colors.primary : colors.mutedForeground}
                glow={masteryIsStrong(t.correct, t.total)} revealDelayMs={barDelayMs(i)}
                labelStyle={styles.tallyName} valueStyle={styles.tallyCount} maxFontSizeMultiplier={1} accessibilityLabel={masteryLabel(t.concept, t.correct, t.total)} testID="row-section-tally" />
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
        <PressScale gradient={last} accessibilityRole="button" disabled={busy} onPress={() => { setJustAnsweredId(null); if (last) void gradeSet(); else setReviewingId(null); }} style={[last ? styles.primaryButton : styles.nextButton, busy && styles.disabled]} testID="button-live-next">
          {busy ? <ActivityIndicator color={last ? colors.primaryForeground : colors.background} /> : <><CardText style={last ? styles.primaryText : styles.nextText}>{last ? 'See the score' : 'Next question'}</CardText><Feather name="arrow-right" size={18} color={last ? colors.primaryForeground : colors.background} /></>}
        </PressScale>
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
        {/* D-126: the real count of questions written so far. */}
        <ProgressBar {...writtenProgress(questions.length, total)} testID="progress-writing" />
        <QuestionSkeleton caption={`Writing question ${questions.length + 1}…`} />
      </View>
    );
  } else {
    live = (
      <View style={styles.live} onLayout={liveLayout(step)} testID="panel-live-grade">
        <CardText style={styles.heading}>All {questions.length} answered.</CardText>
        <PressScale gradient accessibilityRole="button" disabled={busy} onPress={() => void gradeSet()} style={[styles.primaryButton, busy && styles.disabled]} testID="button-live-grade">
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <><CardText style={styles.primaryText}>Grade</CardText><Feather name="arrow-right" size={18} color={colors.primaryForeground} /></>}
        </PressScale>
      </View>
    );
  }

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, quiz.grade && glassBorder(colors.scheme)]} testID="card-live-set">
      {/* D-179: once graded, the card is frosted glass over the aurora. */}
      {quiz.grade ? <GlassFill /> : null}
      <View style={styles.head}>
        {/* D-130: "All topics" with each section on its own line, not one long capitalised run.
            D-191: title and sections stack in one column beside the count; in one row they ran off the card. */}
        <View style={styles.headCopy}>
          <CardText style={styles.kicker}>Practice · {topicParts(session.topic).title}</CardText>
          {topicParts(session.topic).sections.map((section) => <CardText key={section} style={styles.sectionLine}>{section}</CardText>)}
        </View>
        {!quiz.grade ? <CardText style={styles.headCount} accessibilityLabel={`${answered.length} of ${total} answered`}>{answered.length}/{total}</CardText> : null}
      </View>
      {!quiz.grade ? (
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: answered.length }}>
          <View style={[styles.progressFill, { width: `${total ? Math.round((answered.length / total) * 100) : 0}%` }]} />
        </View>
      ) : null}
      {live}
      {rows}
    </Animated.View>
  );
}

/**
 * The big score (D-179): scales 0.9 → 1.06 → 1 as it appears and counts 0 → `correct` over
 * about 600 ms. Reduce Motion: the final number, still. The accessibility label is the final
 * score, so VoiceOver never reads the intermediate numbers.
 */
function ScoreCountUp({ correct, answered, style, bigStyle, ofStyle }: { correct: number; answered: number; style: object; bigStyle: object; ofStyle: object }) {
  const reduceMotion = useReducedMotion();
  const shown = useCountUp(correct);
  const scale = useSharedValue(reduceMotion ? 1 : 0.9);
  useEffect(() => {
    if (reduceMotion) { scale.value = 1; return; }
    scale.value = withSequence(withTiming(1.06, { duration: 300 }), withTiming(1, { duration: 200 }));
  }, [reduceMotion, scale, correct]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[{ alignSelf: 'flex-start' }, pop]} accessible accessibilityLabel={`Score: ${correct} of ${answered}`} testID="text-score">
      <CardText style={style}><CardText style={bigStyle}>{shown}</CardText><CardText style={ofStyle}>/{answered}</CardText></CardText>
    </Animated.View>
  );
}

/**
 * Text on the card at the reference sizes exactly: the phone's Text Size setting is not applied
 * (Dan, 2026-10-11: the card read a step larger than the Grok reference on the same phone; the
 * reference is a web page, which ignores that setting). The rest of the app still scales.
 */
function CardText(props: React.ComponentProps<typeof Text>) {
  return <Text maxFontSizeMultiplier={1} {...props} />;
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
      <View style={styles.note}><ActivityIndicator color={colors.primaryText} size="small" /><CardText style={styles.noteText}>{caption}</CardText></View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { marginTop: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  headCopy: { flex: 1, gap: 2 },
  sectionLine: { ...TYPE.small, color: colors.mutedForeground },
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
  // Tints: the theme's correct / wrong with alpha (8-digit hex), so both appearances keep their own hues.
  optionCorrect: { borderColor: colors.correct, backgroundColor: `${colors.correct}1f` },
  optionWrong: { borderColor: colors.wrong, backgroundColor: `${colors.wrong}1f` },
  optionMark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  optionMarkRight: { backgroundColor: colors.correct },
  optionMarkWrong: { backgroundColor: colors.wrong },
  optionLetter: { ...TYPE.letter, width: 28, height: 28, borderRadius: 14, textAlign: 'center', overflow: 'hidden', backgroundColor: colors.secondary, color: colors.foreground },
  optionLetterCorrect: { backgroundColor: colors.correct, color: '#ffffff' },
  optionLetterWrong: { backgroundColor: colors.wrong, color: '#ffffff' },
  optionText: { ...TYPE.option, flex: 1, color: colors.foreground },
  optionTextMarked: { fontFamily: FONT.sansSemi },
  feedback: { gap: 10 },
  verdictPanel: { gap: 8, padding: 14, borderRadius: 14, borderWidth: 1 },
  verdictPanelWrong: { borderColor: colors.wrong, backgroundColor: `${colors.wrong}14` },
  verdictPanelRight: { borderColor: colors.correct, backgroundColor: `${colors.correct}14` },
  verdictTitle: { ...TYPE.bodySemi, fontSize: 17 },
  body: { ...TYPE.body, color: colors.foreground },
  small: { ...TYPE.small, color: colors.mutedForeground },
  muted: { ...TYPE.small, color: colors.mutedForeground },
  hook: { gap: 6, padding: 14, borderRadius: 14, backgroundColor: colors.hookBg },
  hookHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hookKicker: { ...TYPE.kicker, color: colors.hookText },
  hookText: { ...TYPE.bodySemi, color: colors.hookText }, // D-171: amber box, amber text
  heading: { ...TYPE.heading, color: colors.foreground },
  score: { color: colors.foreground },
  scoreBig: { ...TYPE.score, color: colors.foreground },
  scoreOf: { ...TYPE.scoreOf, color: colors.mutedForeground },
  tallies: { gap: 10, paddingTop: 4 },
  tallyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tallyName: { ...TYPE.small, color: colors.foreground },
  tallyCount: { ...TYPE.smallSemi, color: colors.mutedForeground },
  // Report link: small and away from the main button on purpose (UX_PRINCIPLES: destructive-ish actions are small and separated).
  reportLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  reportLinkText: { ...TYPE.smallSemi, color: colors.mutedForeground, textDecorationLine: 'underline' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.background },
  noteText: { ...TYPE.small, flex: 1, color: colors.foreground },
  noteStrong: { fontFamily: FONT.sansSemi },
  primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 16 },
  primaryText: { ...TYPE.button, color: colors.primaryForeground },
  nextButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: colors.foreground, paddingHorizontal: 16 },
  nextText: { ...TYPE.button, color: colors.background },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { ...TYPE.smallSemi, color: colors.foreground },
  skeletonWrap: { gap: 12 },
  skeleton: { gap: 10 },
  skeletonFirstOption: { marginTop: 6 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
