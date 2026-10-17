import { useEffect, useRef, useState, type FormEvent } from 'react';
import { blocksOf, type Span } from './lib/coach-text';
import { useQueryClient } from '@tanstack/react-query';
import { getGetHomeChatQueryKey, useGetHomeChat, useOpenHomeChat, useSendHomeChatMessage, type HomeChat as HomeChatData } from '@workspace/api-client-react';
import QuizCard from './QuizCard';
import FlashcardDeck from './FlashcardDeck';
import type { TimedSize } from './lib/exam-facts';

const FINISHED_SET_MESSAGE = 'I finished the set.';
const FINISHED_DECK_MESSAGE = 'I finished the flashcards.';

/**
 * Chat-first home (SPEC §7, D-016), web version of the iPhone Coach tab. The coach can
 * create a course or start a study session; the parent opens the session.
 */
export default function HomeChat({ aiConsent, busy, courseId, timedChoices = [], passMark, onCoursesChanged, onOpenSession }: {
  aiConsent: boolean;
  busy?: boolean;
  /** The course/exam selected on the page; the coach assumes it when a message does not name one. */
  courseId?: string | null;
  /** Timed exam choices for the selected certification exam (D-114); empty hides them. */
  timedChoices?: { size: TimedSize; label: string }[];
  /** The real exam's pass mark line for a timed exam's score (D-115). */
  passMark?: string;
  onCoursesChanged: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const client = useQueryClient();
  // One thread per course (D-038): the chat follows the selected course; none = the general thread.
  const chatParams = courseId ? { courseId } : undefined;
  const chatKey = getGetHomeChatQueryKey(chatParams);
  const chat = useGetHomeChat(chatParams);
  const send = useSendHomeChatMessage();
  const open = useOpenHomeChat();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [gradedSessionId, setGradedSessionId] = useState<string | null>(null);
  const [finishedDeckId, setFinishedDeckId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = chat.data?.messages ?? [];
  const version = chat.data?.version ?? 0;
  const sending = send.isPending;
  const activeQuiz = chat.data?.activeQuiz ?? null;
  const activeDeck = chat.data?.activeDeck ?? null;
  const quizSessionId = activeQuiz?.sessionId ?? gradedSessionId;
  const deckSessionId = activeDeck?.sessionId ?? finishedDeckId;
  const lastMessage = messages[messages.length - 1];
  const chips = lastMessage?.role === 'assistant' && !activeQuiz && !activeDeck ? (lastMessage.suggestions ?? []) : [];

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  // A new study session starts when the page opens or the tab comes back (server adds the greeting only after a real break).
  const openRef = useRef(open.mutateAsync);
  openRef.current = open.mutateAsync;
  useEffect(() => {
    if (!aiConsent) return;
    const key = chatKey;
    const openSession = () => { openRef.current({ data: chatParams ?? {} }).then(result => client.setQueryData(key, result)).catch(() => {}); };
    openSession();
    const onVisible = () => { if (document.visibilityState === 'visible') openSession(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [aiConsent, courseId]);
  useEffect(() => { setGradedSessionId(null); setFinishedDeckId(null); }, [courseId]);

  const sendText = async (text: string, timed?: TimedSize) => {
    const content = text.trim();
    if (!content || sending || busy || !aiConsent) return;
    setError('');
    try {
      const result: HomeChatData = await send.mutateAsync({ data: { content, version, ...(courseId ? { courseId } : {}), ...(timed ? { timedExam: { size: timed } } : {}) } });
      client.setQueryData(chatKey, result);
      if (result.activeQuiz) { setGradedSessionId(null); setFinishedDeckId(null); }
      if (result.activeDeck) { setFinishedDeckId(null); setGradedSessionId(null); }
      setDraft('');
      const actions = result.messages[result.messages.length - 1]?.actions ?? [];
      if (actions.some(action => action.type === 'create_course')) onCoursesChanged();
      const started = actions.find(action => action.type === 'start_session' && action.sessionId);
      if (started?.sessionId) onOpenSession(started.sessionId);
    } catch (problem) {
      const status = (problem as { status?: number }).status;
      if (status === 409) void client.invalidateQueries({ queryKey: chatKey });
      const data = (problem as { data?: { error?: unknown } }).data;
      setError(data && typeof data.error === 'string' ? data.error : 'The coach could not answer just now. Try again.');
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void sendText(draft); };

  return (
    <section className="ae-card" data-testid="panel-home-chat" style={{ marginBottom: 17 }}>
      <div className="ae-card-top"><div><span className="ae-kicker">YOUR COACH</span><h2 className="ae-heading">What are we working on?</h2></div></div>
      <div className="ae-turns" style={{ display: 'grid', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
        {chat.isLoading && <p className="ae-muted">Loading your chat…</p>}
        {chat.error && <p className="ae-muted" role="alert">Couldn’t load your chat. <button type="button" className="ae-button ae-button--quiet" onClick={() => void chat.refetch()}>Try again</button></p>}
        {!chat.isLoading && !messages.length && (
          <article className="ae-turn ae-turn--coach"><span className="ae-turn-badge">AI</span>
            <div className="ae-turn-content"><p>Hey. Which course or certification exam are we working on? You can also add notes, a syllabus, or photos with the materials panel, or record a lecture on your iPhone.</p></div>
          </article>
        )}
        {messages.map(turn => (
          <div key={turn.id}>
          {turn.sessionStart && <p className="ae-kicker" style={{ textAlign: 'center', margin: '6px 0' }}>NEW SESSION</p>}
          <article className={`ae-turn ae-turn--${turn.role === 'user' ? 'student' : 'coach'}`} data-testid={`chat-turn-${turn.role}`}>
            <span className="ae-turn-badge">{turn.role === 'user' ? 'YOU' : 'AI'}</span>
            <div className="ae-turn-content">
              {turn.role === 'assistant'
                ? blocksOf(turn.content).map((block, i) => {
                  // D-098: bold section headings with space above, bullets, inline bold.
                  const inline = (spans: Span[]) => spans.map((sp, k) => sp.bold ? <strong key={k}>{sp.text}</strong> : <span key={k}>{sp.text}</span>);
                  if (block.kind === 'heading') return <p key={i} style={{ fontWeight: 700, marginTop: i > 0 ? '1em' : 0 }}>{block.spans[0]?.text}</p>;
                  if (block.kind === 'bullet') return <p key={i} style={{ paddingLeft: '1em', textIndent: '-.8em' }}>• {inline(block.spans)}</p>;
                  if (block.kind === 'trick') return <p key={i} className="sc-miss-hook sc-trick">⚡ {block.label ? <strong>{block.label}: </strong> : null}{inline(block.spans)}</p>;
                  return <p key={i}>{inline(block.spans)}</p>;
                })
                : <p>{turn.content}</p>}
              {turn.actions?.map(action => action.type === 'update_memory_sheet' ? (
                <p key={`sheet-${action.courseId}-${action.rows?.[0]?.id ?? ''}`} className="ae-muted" style={{ fontSize: '.85rem' }} data-testid="card-memory-sheet">Saved to your memory sheet</p>
              ) : action.type === 'update_course_notes' || action.type === 'undo_course_notes' ? (
                <p key={`notes-${action.type}-${action.courseId}-${action.summary ?? ''}`} className="ae-muted" style={{ fontSize: '.85rem' }} data-testid="card-course-notes">{action.type === 'undo_course_notes' ? `Undid in your notes: ${action.summary ?? ''}` : `Updated your notes: ${action.summary ?? ''}`}</p>
              ) : (
                <p key={`${action.type}-${action.courseId}-${action.sessionId ?? ''}`} className="ae-muted" style={{ fontSize: '.85rem' }}>
                  {action.type === 'create_course' ? `Added course: ${action.name ?? ''}`
                    : action.type === 'start_quiz' ? `${action.kind === 'practice' ? 'Practice' : 'Exam'} set: ${action.count ?? ''} questions on ${action.topic ?? ''}`
                    : action.type === 'start_flashcards' ? `Flashcards: ${action.count ?? ''} cards on ${action.topic ?? ''}`
                    : <>Started a session: {action.topic ?? ''}{action.sessionId && <> · <button type="button" className="ae-button ae-button--quiet" onClick={() => onOpenSession(action.sessionId!)} data-testid="button-open-session">Open</button></>}</>}
                </p>
              ))}
            </div>
          </article>
          </div>
        ))}
        {chips.length > 0 && <div className="ae-row" data-testid="row-suggestions">
          {chips.map(chip => <button key={chip} type="button" className="ae-button ae-button--outline" disabled={sending || busy} onClick={() => void sendText(chip)} data-testid="button-suggestion">{chip}</button>)}
        </div>}
        {timedChoices.length > 0 && !activeQuiz && !activeDeck && <div className="ae-row" style={{ flexWrap: 'wrap', gap: 8 }} data-testid="row-timed-exam">
          <span className="ae-muted">Simulated exam, timed:</span>
          {timedChoices.map(choice => <button key={choice.size} type="button" className="ae-button ae-button--outline" disabled={sending || busy} onClick={() => void sendText(`Timed exam: ${choice.label}`, choice.size)} data-testid={`button-timed-${choice.size}`}>{choice.label}</button>)}
        </div>}
        {deckSessionId && <FlashcardDeck key={deckSessionId} sessionId={deckSessionId}
          onFinished={finished => { setFinishedDeckId(finished.id); void sendText(FINISHED_DECK_MESSAGE); }}
          onError={problem => { const data = (problem as { data?: { error?: unknown } }).data; setError(data && typeof data.error === 'string' ? data.error : 'Something went wrong. Try again.'); }} />}
        {!deckSessionId && quizSessionId && <QuizCard key={quizSessionId} sessionId={quizSessionId} passMark={passMark}
          onGraded={graded => { setGradedSessionId(graded.id); void sendText(FINISHED_SET_MESSAGE); }}
          onError={problem => { const data = (problem as { data?: { error?: unknown } }).data; setError(data && typeof data.error === 'string' ? data.error : 'Something went wrong. Try again.'); }} />}
        {sending && <p className="ae-muted">Coach is working… writing questions can take up to a minute.</p>}
        <div ref={endRef} />
      </div>
      {error && <p className="ae-callout ae-callout--error" role="alert" data-testid="status-chat-error" style={{ marginTop: 12 }}>{error}</p>}
      <form className="ae-row" onSubmit={event => void submit(event)} style={{ marginTop: 14 }}>
        <input className="ae-input" aria-label="Message your coach" placeholder={aiConsent ? 'Message your coach' : 'Accept the AI notice below to chat'} value={draft}
          onChange={event => setDraft(event.target.value)} maxLength={8000} disabled={!aiConsent || sending || busy} style={{ flex: 1, minWidth: 200 }} data-testid="input-home-chat" />
        <button type="submit" className="ae-button ae-button--ink" disabled={!aiConsent || sending || busy || !draft.trim()} data-testid="button-send-home-chat">Send</button>
      </form>
    </section>
  );
}
