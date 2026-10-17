import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudySessionQueryKey, useGetStudySession, useReviewFlashcard, type StudySession } from '@workspace/api-client-react';
import { cardLines } from './lib/card-text';
import { spansOf } from './lib/coach-text';
import { topicParts } from './lib/topic-label';

/** Flashcards in the home chat (D-021), web version of the iPhone FlashcardDeck. */
export default function FlashcardDeck({ sessionId, onFinished, onError }: {
  sessionId: string;
  onFinished: (session: StudySession) => void;
  onError: (problem: unknown) => void;
}) {
  const client = useQueryClient();
  const key = getGetStudySessionQueryKey(sessionId);
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key } });
  const review = useReviewFlashcard();
  const [flipped, setFlipped] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const session = sessionQuery.data;
  const deck = session?.flashcards ?? null;
  const busy = review.isPending;
  const pending = (deck?.cards ?? []).filter(card => card.results[card.results.length - 1] !== 'got');
  const current = [...pending].sort((a, b) => a.results.length - b.results.length)[0];
  const total = deck?.cards.length ?? 0;
  const done = total - pending.length;
  const step = !deck ? 'loading' : deck.completedAt ? 'finished' : `${current?.id ?? 'none'}:${flipped ? 'back' : 'front'}`;
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step]);

  if (sessionQuery.isLoading) return <div className="ae-card ae-card--compact" ref={topRef}><p className="ae-muted">Loading your cards…</p></div>;
  if (!session || !deck) return <div className="ae-card ae-card--compact" ref={topRef}><p className="ae-muted">Couldn’t load this deck. <button type="button" className="ae-button ae-button--quiet" onClick={() => void sessionQuery.refetch()}>Retry</button></p></div>;

  if (deck.completedAt || !current) {
    const again = deck.cards.filter(card => card.results.includes('again'));
    return (
      <div className="ae-card ae-card--compact" data-testid="panel-deck-finished" ref={topRef}>
        <span className="ae-kicker">FLASHCARDS · {topicParts(session.topic).title}</span>
        <p style={{ fontSize: '2rem', fontWeight: 700, margin: '6px 0' }}>{total} / {total}</p>
        <p>{again.length ? `${again.length} card${again.length === 1 ? '' : 's'} needed a second look.` : 'Every card on the first try.'}</p>
        {again.map(card => <p key={card.id} className="ae-muted">• {card.concept}</p>)}
      </div>
    );
  }

  const mark = async (result: 'got' | 'again') => {
    if (busy) return;
    try {
      const updated = await review.mutateAsync({ id: sessionId, cardId: current.id, data: { result } });
      client.setQueryData(key, updated);
      setFlipped(false);
      if (updated.flashcards?.completedAt) onFinished(updated);
    } catch (problem) { onError(problem); }
  };

  return (
    <div className="ae-card ae-card--compact" data-testid="panel-deck-card" ref={topRef}>
      <span className="ae-kicker">FLASHCARDS · CARD {done + 1} OF {total}{current.results.length ? ' · AGAIN' : ''}</span>
      <button type="button" className="ae-card ae-card--tint" style={{ width: '100%', minHeight: 140, textAlign: 'left', cursor: 'pointer', marginTop: 10 }} onClick={() => setFlipped(f => !f)} data-testid="button-flip-card">
        <span className="ae-kicker">{flipped ? 'ANSWER' : 'TAP TO FLIP'}</span>
        <div style={{ display: 'grid', gap: 10 }}>{cardLines(flipped ? current.back : current.front).map((line, i) => <p key={i} style={{ fontSize: '1.1rem', margin: 0 }}>{spansOf(line).map((sp, k) => sp.bold ? <strong key={k}>{sp.text}</strong> : <span key={k}>{sp.text}</span>)}</p>)}</div>
      </button>
      {flipped ? (
        <div className="ae-row" style={{ marginTop: 10 }}>
          <button type="button" className="ae-button ae-button--outline" disabled={busy} onClick={() => void mark('again')} data-testid="button-card-again">Again</button>
          <button type="button" className="ae-button ae-button--ink" disabled={busy} onClick={() => void mark('got')} data-testid="button-card-got">Got it</button>
        </div>
      ) : <p className="ae-muted" style={{ marginTop: 8 }}>Say the answer to yourself, then flip.</p>}
    </div>
  );
}
