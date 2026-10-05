import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudySessionQueryKey, useGetStudySession, useGradeStudyQuiz, useSaveStudyAnswer, type StudySession } from '@workspace/api-client-react';

/**
 * One question at a time inside the home chat (SPEC §6 steps 4–5), web version of the
 * iPhone QuizCard. Practice sets show feedback after each answer; exam sets after Grade.
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
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const session = sessionQuery.data;
  const quiz = session?.quiz ?? null;
  const busy = saveAnswer.isPending || grade.isPending;

  if (sessionQuery.isLoading) return <div className="ae-card ae-card--compact"><p className="ae-muted">Loading your questions…</p></div>;
  if (!session || !quiz) return <div className="ae-card ae-card--compact"><p className="ae-muted">Couldn’t load this set. <button type="button" className="ae-button ae-button--quiet" onClick={() => void sessionQuery.refetch()}>Retry</button></p></div>;

  const questions = quiz.questions.filter(q => !q.flag);
  const answered = questions.filter(q => q.answer);
  const kindLabel = quiz.kind === 'practice' ? 'PRACTICE' : 'EXAM';

  if (quiz.grade) {
    const misses = questions.filter(q => q.feedback?.selectedOptionId && q.feedback.selectedOptionId !== q.feedback.correctOptionId);
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-score">
        <span className="ae-kicker">{kindLabel} · {session.topic}</span>
        <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>{quiz.grade.correct} / {quiz.grade.answered}</p>
        <p>{quiz.grade.percent}% on the questions you answered{quiz.grade.unanswered ? ` · ${quiz.grade.unanswered} skipped` : ''}.</p>
        <h3 className="ae-heading" style={{ fontSize: '1.05rem' }}>{misses.length ? 'What you missed' : 'Nothing missed. Nice.'}</h3>
        {misses.map((q, i) => (
          <div key={q.id} data-testid={`quiz-miss-${i}`} style={{ borderTop: '1px solid var(--ae-line)', paddingTop: 8, marginTop: 8 }}>
            <p>{q.prompt}</p>
            <p style={{ color: 'var(--destructive, #b33b2d)' }}>You chose: {q.feedback!.selectedOptionText}</p>
            <p><strong>Correct: {q.feedback!.correctOptionText}</strong></p>
            <p className="ae-muted">{q.feedback!.explanation}</p>
          </div>
        ))}
      </div>
    );
  }

  const reviewing = reviewingId ? questions.find(q => q.id === reviewingId) : undefined;
  if (reviewing?.feedback) {
    const correct = reviewing.feedback.selectedOptionId === reviewing.feedback.correctOptionId;
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-feedback">
        <span className="ae-kicker">{kindLabel} · QUESTION {questions.indexOf(reviewing) + 1} OF {questions.length}</span>
        <p>{reviewing.prompt}</p>
        <p><strong>{correct ? 'Correct' : 'Not quite'}</strong></p>
        {!correct && <p style={{ color: 'var(--destructive, #b33b2d)' }}>You chose: {reviewing.feedback.selectedOptionText}</p>}
        <p><strong>Correct: {reviewing.feedback.correctOptionText}</strong></p>
        <p className="ae-muted">{reviewing.feedback.explanation}</p>
        <button type="button" className="ae-button ae-button--ink" onClick={() => setReviewingId(null)} data-testid="button-quiz-next">{answered.length >= questions.length ? 'See the score' : 'Next question'}</button>
      </div>
    );
  }

  const current = questions.find(q => !q.answer);
  if (!current) {
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-quiz-grade">
        <span className="ae-kicker">{kindLabel} · {session.topic}</span>
        <p>All {questions.length} answered.</p>
        <button type="button" className="ae-button ae-button--ink" disabled={busy} data-testid="button-quiz-grade" onClick={async () => {
          try { const graded = await grade.mutateAsync({ id: sessionId }); client.setQueryData(key, graded); onGraded(graded); } catch (problem) { onError(problem); }
        }}>Grade</button>
      </div>
    );
  }

  return (
    <div className="ae-card ae-card--compact" data-testid="panel-quiz-question">
      <span className="ae-kicker">{kindLabel} · QUESTION {questions.indexOf(current) + 1} OF {questions.length}</span>
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
            <strong style={{ marginRight: 10 }}>{'ABCD'[i]}</strong>{option.text}
          </button>
        ))}
      </div>
    </div>
  );
}
