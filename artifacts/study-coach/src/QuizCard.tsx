import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer, type StudyQuestionFlagInputKind, type StudySession, type StudyQuizQuestionsItem } from '@workspace/api-client-react';

/**
 * One question at a time inside the home chat (SPEC §6 steps 4–5), web version of the
 * iPhone QuizCard. Practice sets show feedback after each answer; exam sets after Grade.
 * "Looks wrong?" (D-034) reports a question; the server re-checks it and the verdict shows in place.
 */
export default function QuizCard({ sessionId, onGraded, onError }: {
  sessionId: string;
  onGraded: (session: StudySession) => void;
  onError: (problem: unknown) => void;
}) {
  const client = useQueryClient();
  const key = getGetStudySessionQueryKey(sessionId);
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key } });
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

  if (sessionQuery.isLoading) return <div className="ae-card ae-card--compact" ref={topRef}><p className="ae-muted">Loading your questions…</p></div>;
  if (!session || !quiz) return <div className="ae-card ae-card--compact"><p className="ae-muted">Couldn’t load this set. <button type="button" className="ae-button ae-button--quiet" onClick={() => void sessionQuery.refetch()}>Retry</button></p></div>;

  const questions = quiz.questions.filter(counts);
  const answered = questions.filter(q => q.answer);
  const kindLabel = quiz.kind === 'practice' ? 'PRACTICE' : 'EXAM';

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
        <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>{quiz.grade.correct} / {quiz.grade.answered}</p>
        <p>{quiz.grade.percent}% on the questions you answered{quiz.grade.unanswered ? ` · ${quiz.grade.unanswered} skipped` : ''}.</p>
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
  if (!current) {
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-grade" ref={topRef}>
        <span className="ae-kicker">{kindLabel} · {session.topic}</span>
        <p>All {questions.length} answered.</p>
        <button type="button" className="ae-button ae-button--ink" disabled={busy} data-testid="button-quiz-grade" onClick={async () => {
          try { const graded = await grade.mutateAsync({ id: sessionId }); client.setQueryData(key, graded); onGraded(graded); } catch (problem) { onError(problem); }
        }}>Grade</button>
      </div>
    );
  }

  return (
    <div className="ae-card ae-card--compact" data-testid="panel-quiz-question" ref={topRef}>
      <span className="ae-kicker">{kindLabel} · QUESTION {questions.indexOf(current) + 1} OF {questions.length}</span>
      <progress value={answered.length} max={questions.length} style={{ width: '100%' }} aria-label="Answered" /><p className="ae-muted" style={{ fontSize: '.8rem' }}>{answered.length} of {questions.length} answered</p>
      <p style={{ fontWeight: 600 }}>{current.prompt}</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {current.options.map((option, i) => (
          <button key={option.id} type="button" className="ae-button ae-button--outline" disabled={busy} data-testid={`button-quiz-option-${i}`} style={{ textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={async () => {
              try {
                const updated = await saveAnswer.mutateAsync({ id: sessionId, data: { questionId: current.id, optionId: option.id, assisted: false } });
                client.setQueryData(key, updated);
                if (quiz.kind === 'practice') setReviewingId(current.id);
              } catch (problem) { onError(problem); }
            }}>
            <strong style={{ marginRight: 10 }}>{'ABCDE'[i]}</strong>{option.text}
          </button>
        ))}
      </div>
    </div>
  );
}
