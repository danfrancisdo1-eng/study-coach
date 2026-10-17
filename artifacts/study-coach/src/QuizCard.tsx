import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clockText, clockTone, scoreLine, secondsLeft, timeUsedLine } from './lib/exam-sheet';
import ProgressBar from './ProgressBar';
import { writtenProgress } from './lib/progress';
import { getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer, type StudyQuestionFlagInputKind, type StudySession, type StudyQuizQuestionsItem } from '@workspace/api-client-react';

/**
 * One question at a time inside the home chat (SPEC §6 steps 4–5), web version of the
 * iPhone QuizCard. Practice sets show feedback after each answer; exam sets after Grade.
 * "Looks wrong?" (D-034) reports a question; the server re-checks it and the verdict shows in place.
 */
export default function QuizCard({ sessionId, passMark, onGraded, onError }: {
  sessionId: string;
  /** The real exam's pass mark line, shown on a timed exam's score (D-115). */
  passMark?: string;
  onGraded: (session: StudySession) => void;
  onError: (problem: unknown) => void;
}) {
  const client = useQueryClient();
  const key = getGetStudySessionQueryKey(sessionId);
  // Polled while the rest of the set is still being written (D-052, D-114), like the phone.
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key, refetchInterval: query => (query.state.data?.quiz?.status === 'writing' ? 1500 : false) } });
  const saveAnswer = useSaveStudyAnswer();
  const grade = useGradeStudyQuiz();
  const flag = useFlagStudyQuestion();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [askingId, setAskingId] = useState<string | null>(null);
  const session = sessionQuery.data;
  const quiz = session?.quiz ?? null;
  const busy = saveAnswer.isPending || grade.isPending;
  const topRef = useRef<HTMLDivElement>(null);
  // A reported question stays out of the set unless the re-check confirmed its key.
  const counts = (q: StudyQuizQuestionsItem) => !q.flag || q.flag.recheck?.verdict === 'key_holds';
  const step = !quiz ? 'loading' : quiz.grade ? 'score' : reviewingId ? `feedback:${reviewingId}` : `question:${quiz.questions.find(q => counts(q) && !q.answer)?.id ?? 'grade'}`;
  // Each new question / feedback / score starts at the top of the card, not at the end of the chat.
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step]);

  // Timed exams (D-115): the clock from the server's deadline; at 0:00 the set is graded with what was answered.
  const timer = quiz && !quiz.grade ? quiz.timer ?? null : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer?.deadline]);
  const left = timer ? secondsLeft(timer.deadline, now) : null;
  const autoGrading = useRef(false);
  const gradeNow = async () => {
    try { const graded = await grade.mutateAsync({ id: sessionId }); client.setQueryData(key, graded); onGraded(graded); } catch (problem) { onError(problem); }
  };
  useEffect(() => {
    if (left !== 0 || autoGrading.current || grade.isPending) return;
    autoGrading.current = true;
    void (async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { const graded = await grade.mutateAsync({ id: sessionId }); client.setQueryData(key, graded); onGraded(graded); return; }
        catch { await new Promise(r => setTimeout(r, 3000)); }
      }
      autoGrading.current = false;
      void sessionQuery.refetch();
    })();
  }, [left]);

  if (sessionQuery.isLoading) return <div className="ae-card ae-card--compact" ref={topRef}><p className="ae-muted">Loading your questions…</p></div>;
  if (!session || !quiz) return <div className="ae-card ae-card--compact"><p className="ae-muted">Couldn’t load this set. <button type="button" className="ae-button ae-button--quiet" onClick={() => void sessionQuery.refetch()}>Retry</button></p></div>;

  const questions = quiz.questions.filter(counts);
  const answered = questions.filter(q => q.answer);
  const kindLabel = quiz.kind === 'practice' ? 'PRACTICE' : 'EXAM';
  const writing = quiz.status === 'writing';
  const total = writing ? Math.max(quiz.expectedCount, questions.length) : questions.length;
  const tone = left === null ? 'normal' : clockTone(left);
  const toneColor = tone === 'red' ? '#d6453a' : tone === 'amber' ? '#a35c00' : undefined;
  const clock = left === null ? null : (
    <p role="timer" aria-label={`${clockText(left)} left`} data-testid="text-exam-clock" style={{ display: 'inline-flex', gap: 10, alignItems: 'baseline', padding: '4px 12px', borderRadius: 12, border: `2px solid ${toneColor ?? 'currentColor'}`, margin: '0 0 8px' }}>
      <strong style={{ fontSize: '1.25rem', fontVariantNumeric: 'tabular-nums', color: toneColor }}>{clockText(left)}</strong>
      <span className="ae-muted" style={{ fontSize: '.85rem' }}>{left === 0 ? 'Time is up. Grading…' : tone === 'red' ? 'Under a minute left' : tone === 'amber' ? 'Under 5 minutes left' : `of ${clockText((timer?.limitMinutes ?? 0) * 60)}`}</span>
    </p>
  );

  const send = async (question: StudyQuizQuestionsItem, kind: StudyQuestionFlagInputKind) => {
    setAskingId(null); setReportingId(question.id);
    try {
      const updated = await flag.mutateAsync({ id: sessionId, questionId: question.id, data: { kind } });
      client.setQueryData(key, updated);
    } catch (problem) { onError(problem); } finally { setReportingId(null); }
  };
  const reportNote = (q: StudyQuizQuestionsItem) => {
    if (reportingId === q.id) return <p className="ae-muted" style={{ fontSize: '.85rem' }} data-testid="status-recheck">Checking the answer again…</p>;
    const recheck = q.flag?.recheck;
    if (q.flag && !recheck) return <p className="ae-muted" style={{ fontSize: '.85rem' }} data-testid="note-recheck">Reported. This question won’t count.</p>;
    if (recheck) {
      const youWereRight = recheck.verdict === 'key_wrong' && !!q.answer && recheck.correctOptionId === q.answer.optionId;
      const headline = recheck.verdict === 'key_holds' ? 'Checked again: the answer key holds.'
        : recheck.verdict === 'key_wrong' ? (youWereRight ? `You’re right. The correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count against you.` : `The answer key was wrong: the correct answer is ${recheck.correctOptionText ?? ''}. This question won’t count.`)
        : 'This question is unclear, so it won’t count.';
      return <p style={{ fontSize: '.85rem' }} data-testid={`note-recheck-${recheck.verdict}`}><strong>{headline}</strong> {recheck.explanation}</p>;
    }
    if (askingId === q.id) return (
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ae-button ae-button--quiet" onClick={() => void send(q, 'wrong_answer')} data-testid={`button-report-wrong-${q.id}`}>The answer is wrong</button>
        <button type="button" className="ae-button ae-button--quiet" onClick={() => void send(q, 'ambiguous')} data-testid={`button-report-unclear-${q.id}`}>The question is unclear</button>
        <button type="button" className="ae-button ae-button--quiet" onClick={() => setAskingId(null)}>Cancel</button>
      </p>
    );
    return <p><button type="button" className="ae-button ae-button--quiet" style={{ fontSize: '.8rem' }} disabled={!!reportingId} onClick={() => setAskingId(q.id)} data-testid={`button-report-${q.id}`}>Looks wrong?</button></p>;
  };

  if (quiz.grade) {
    const misses = quiz.questions.filter(q => q.feedback?.selectedOptionId && (q.feedback.selectedOptionId !== q.feedback.correctOptionId || (q.flag && !counts(q))));
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-score" ref={topRef}>
        <span className="ae-kicker">{kindLabel} · {session.topic}</span>
        <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>{quiz.grade.correct} / {quiz.grade.limitMinutes ? quiz.grade.answered + quiz.grade.unanswered : quiz.grade.answered}</p>
        <p>{scoreLine(quiz.grade)}</p>
        {timeUsedLine(quiz.grade) && <p className="ae-muted" data-testid="text-time-used">{timeUsedLine(quiz.grade)}</p>}
        {quiz.grade.limitMinutes && passMark ? <p className="ae-muted" data-testid="text-pass-mark">{passMark}</p> : null}
        <h3 className="ae-heading" style={{ fontSize: '1.05rem' }}>{misses.length ? 'What you missed' : 'Nothing missed. Nice.'}</h3>
        {misses.map((q, i) => (
          <div key={q.id} data-testid={`quiz-miss-${i}`} className="sc-miss">
            <p className="sc-miss-prompt">{q.prompt}</p>
            <p className="sc-miss-wrong">You chose: {q.feedback!.selectedOptionText}</p>
            <p className="sc-miss-right">Correct: {q.feedback!.correctOptionText}</p>
            <p className="sc-miss-explain">{q.feedback!.explanation}</p>
            {q.feedback!.hook && <p className="sc-miss-hook">⚡ {q.feedback!.hook}</p>}
            {reportNote(q)}
          </div>
        ))}
      </div>
    );
  }

  const reviewing = reviewingId ? quiz.questions.find(q => q.id === reviewingId) : undefined;
  if (reviewing?.feedback) {
    const correct = reviewing.feedback.selectedOptionId === reviewing.feedback.correctOptionId;
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-feedback" ref={topRef}>
        <span className="ae-kicker">{kindLabel} · {questions.indexOf(reviewing) >= 0 ? `QUESTION ${questions.indexOf(reviewing) + 1} OF ${questions.length}` : 'REPORTED QUESTION'}</span>
        <div className="sc-miss">
          <p className="sc-miss-prompt">{reviewing.prompt}</p>
          <p className={correct ? 'sc-miss-right' : 'sc-miss-wrong'}><strong>{correct ? 'Correct' : 'Not quite'}</strong></p>
          {!correct && <p className="sc-miss-wrong">You chose: {reviewing.feedback.selectedOptionText}</p>}
          <p className="sc-miss-right">Correct: {reviewing.feedback.correctOptionText}</p>
          <p className="sc-miss-explain">{reviewing.feedback.explanation}</p>
          {!correct && reviewing.feedback.hook && <p className="sc-miss-hook">⚡ {reviewing.feedback.hook}</p>}
          {reportNote(reviewing)}
        </div>
        <button type="button" className="ae-button ae-button--ink" onClick={() => setReviewingId(null)} data-testid="button-quiz-next">{answered.length >= questions.length ? 'See the score' : 'Next question'}</button>
      </div>
    );
  }

  const current = questions.find(q => !q.answer);
  if (!current && writing) {
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-writing" ref={topRef}>
        {clock}
        <span className="ae-kicker">{kindLabel} · {session.topic}</span>
        {/* D-126: the real count of questions written so far. */}
        {(() => { const p = writtenProgress(questions.length, total); return <ProgressBar fraction={p.fraction} label={p.label} testId="progress-writing" />; })()}
      </div>
    );
  }
  if (!current) {
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-grade" ref={topRef}>
        {clock}
        <span className="ae-kicker">{kindLabel} · {session.topic}</span>
        <p>All {questions.length} answered.</p>
        <button type="button" className="ae-button ae-button--ink" disabled={busy} data-testid="button-quiz-grade" onClick={() => void gradeNow()}>Grade</button>
      </div>
    );
  }

  return (
    <div className="ae-card ae-card--compact" data-testid="panel-quiz-question" ref={topRef}>
      {clock}
      <span className="ae-kicker">{kindLabel} · QUESTION {questions.indexOf(current) + 1} OF {total}</span>
      <progress value={answered.length} max={total} style={{ width: '100%' }} aria-label="Answered" /><p className="ae-muted" style={{ fontSize: '.8rem' }}>{answered.length} of {total} answered</p>
      <p style={{ fontWeight: 600 }}>{current.prompt}</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {current.options.map((option, i) => (
          <button key={option.id} type="button" className="ae-button ae-button--outline" disabled={busy} data-testid={`button-quiz-option-${i}`} style={{ textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={async () => {
              try {
                const updated = await saveAnswer.mutateAsync({ id: sessionId, data: { questionId: current.id, optionId: option.id, assisted: false } });
                client.setQueryData(key, updated);
                if (quiz.kind === 'practice') setReviewingId(current.id);
              } catch (problem) {
                // Out of time (D-112): grade what is there instead of showing an error.
                if ((problem as { data?: { timeUp?: unknown } }).data?.timeUp === true) { void gradeNow(); return; }
                onError(problem);
              }
            }}>
            <strong style={{ marginRight: 10 }}>{'ABCDE'[i]}</strong>{option.text}
          </button>
        ))}
      </div>
    </div>
  );
}
