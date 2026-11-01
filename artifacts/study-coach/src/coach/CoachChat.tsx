import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetHomeChatQueryKey, useCreateReviewSheet, useGetHomeChat, useOpenHomeChat, useReportHomeChatMessage, useSendHomeChatMessage,
  type HomeChat as HomeChatData, type HomeChatInput, type HomeChatMessage,
} from '@workspace/api-client-react';
import { blocksOf, type Block, type Span } from '@phone-lib/coach-text';
import { topicParts } from '@phone-lib/topic-label';
import { reviewHtml } from '@phone-lib/review-html';
import { estimate } from '@phone-lib/progress';
import type { TimedSize } from '@phone-lib/exam-facts';
import { AlreadySent, closeOpenBold, paceStep, sendWithRetry, streamable } from '@phone-lib/chat-stream';
import { friendlyError } from '@phone-lib/friendly-error';
import QuizCard from '../QuizCard';
import ProgressBar, { useElapsed } from '../ProgressBar';
import FlashcardDeck from '../FlashcardDeck';
import { streamChatMessage } from '../lib/coach-stream';
import { premiumCode, REPORT_REASONS, setCardAnchor, type PremiumCode, type ReportReason } from '../lib/coach-ui';

const FINISHED_SET_MESSAGE = 'I finished the set.';
const FINISHED_DECK_MESSAGE = 'I finished the flashcards.';
const REVIEW_CHIP = 'Review sheet (PDF)';
// D-149: the review sheet opens in its own tab with a "Print or save as PDF" bar (the bar never prints).
const withPrintBar = (html: string) => html.replace(/<body([^>]*)>/, '<body$1><div class="rr-print-bar" style="position:sticky;top:0;display:flex;justify-content:flex-end;padding:10px;background:#fff;border-bottom:1px solid #ddd"><button type="button" onclick="window.print()" style="font:600 15px system-ui;padding:10px 16px;border-radius:10px;border:0;background:#F2B544;cursor:pointer">Print or save as PDF</button></div><style>@media print{.rr-print-bar{display:none!important}}</style>');

type Live = { received: string; shown: number; finished: boolean };

const inline = (spans: Span[]) => spans.map((sp, k) => sp.bold ? <strong key={k}>{sp.text}</strong> : <span key={k}>{sp.text}</span>);

/** A coach reply's lines, drawn like the phone (D-098, D-204): section titles, bullets, memory tricks, pop quiz. */
function ReplyBody({ content, onPopQuiz, caret }: { content: string; onPopQuiz: () => void; caret?: boolean }) {
  const blocks = blocksOf(content);
  const out: ReactNode[] = blocks.map((block: Block, i) => {
    const spaced = 'spaced' in block && block.spaced ? ' rr-spaced' : '';
    if (block.kind === 'section') return <div key={i} className="rr-section"><h3>{block.spans[0]?.text}</h3></div>;
    if (block.kind === 'heading' || block.kind === 'tip') return <p key={i} className={`rr-heading${spaced}`}>{block.spans[0]?.text}</p>;
    if (block.kind === 'bullet') return <p key={i} className={`rr-bullet${spaced}`}>• {inline(block.spans)}</p>;
    if (block.kind === 'popquiz') return <button key={i} type="button" className="rr-popquiz" onClick={onPopQuiz} data-testid="chat-pop-quiz">
      <strong>Pop quiz</strong><span>{inline(block.spans)}</span><span className="rr-note">Type your answer below.</span></button>;
    if (block.kind === 'quote') return <p key={i} className={`rr-quote${spaced}`} data-testid="chat-takeaway">{inline(block.spans)}</p>;
    if (block.kind === 'trick') return <div key={i} className={`rr-hook${spaced}`}><div className="rr-hook-title"><Lightbulb size={16} aria-hidden="true" />{block.label || 'Memory trick'}</div><p>{inline(block.spans)}</p></div>;
    return <p key={i} className={spaced.trim()}>{inline(block.spans)}</p>;
  });
  if (caret) out.push(<span key="caret" className="rr-caret" aria-hidden="true" />);
  return <>{out}</>;
}

/**
 * D-303: the web Coach chat (the mock Dan approved), grown from the old web home chat (D-016): one thread per
 * course (D-038), sets, flashcards and timed exams in the chat, the review sheet. New: replies type out while
 * the coach writes them (D-206), Report under each reply, the AI agreement asked when the student first sends,
 * and the plan dialog when the server stops a request (402).
 */
export default function CoachChat({ aiConsent, courseId, timedChoices = [], factPicks, onPickFacts, passMark, onCoursesChanged, onOpenSession, requireConsent, onLimit, onSent }: {
  aiConsent: boolean;
  courseId?: string | null;
  timedChoices?: { size: TimedSize; label: string }[];
  factPicks?: { questions: number[]; minutes: number[]; question: number | null; minute: number | null } | null;
  onPickFacts?: (questions: number, minutes: number) => Promise<void>;
  passMark?: string;
  onCoursesChanged: () => void;
  onOpenSession: (sessionId: string) => void;
  /** Called instead of sending before the AI agreement; `run` carries the action on after the student agrees. */
  requireConsent: (reason: string, run: () => void) => void;
  onLimit: (code: PremiumCode) => void;
  /** A message went through (the live count changes). */
  onSent: () => void;
}) {
  const client = useQueryClient();
  const chatParams = courseId ? { courseId } : undefined;
  const chatKey = getGetHomeChatQueryKey(chatParams);
  const chat = useGetHomeChat(chatParams);
  const send = useSendHomeChatMessage();
  const review = useCreateReviewSheet();
  const open = useOpenHomeChat();
  const report = useReportHomeChatMessage();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const liveResult = useRef<HomeChatData | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [gradedSessionId, setGradedSessionId] = useState<string | null>(null);
  const [finishedDeckId, setFinishedDeckId] = useState<string | null>(null);
  const [pickQ, setPickQ] = useState<number | null>(null);
  const [pickM, setPickM] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messages = chat.data?.messages ?? [];
  const version = chat.data?.version ?? 0;
  const sendElapsed = useElapsed(sending && !live);
  const activeQuiz = chat.data?.activeQuiz ?? null;
  const activeDeck = chat.data?.activeDeck ?? null;
  const quizSessionId = activeQuiz?.sessionId ?? gradedSessionId;
  const deckSessionId = activeDeck?.sessionId ?? finishedDeckId;
  const lastMessage = messages[messages.length - 1];
  const chips = !sending && lastMessage?.role === 'assistant' && !activeQuiz && !activeDeck ? (lastMessage.suggestions ?? []) : [];

  const failed = (problem: unknown) => {
    const code = premiumCode(problem);
    if (code) onLimit(code);
    else setError(friendlyError(problem));
  };

  // D-139: the review sheet opens in a new tab, opened in the click itself (pop-up blockers), filled when written.
  const openReview = (id: string) => {
    const tab = window.open('', '_blank');
    if (!tab) { setError('Allow pop-ups for this site to open the review sheet.'); return; }
    tab.document.write('<p style="font-family:sans-serif;padding:24px">Writing your review sheet…</p>');
    void review.mutateAsync({ courseId: id }).then((sheet) => {
      tab.document.open(); tab.document.write(withPrintBar(reviewHtml(sheet))); tab.document.close(); tab.focus();
    }, (problem) => { tab.close(); failed(problem); });
  };

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, pending, live?.shown]);
  // A study session opens when the page opens or the tab comes back (the server greets only after a real break).
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
  useEffect(() => { setGradedSessionId(null); setFinishedDeckId(null); setReportFor(null); }, [courseId]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const apply = (result: HomeChatData) => {
    client.setQueryData(chatKey, result);
    setPending(null);
    setDraft('');
    if (result.activeQuiz || result.activeDeck) { setGradedSessionId(null); setFinishedDeckId(null); }
    const actions = result.messages[result.messages.length - 1]?.actions ?? [];
    if (actions.some(action => action.type === 'create_course')) onCoursesChanged();
    const started = actions.find(action => action.type === 'start_session' && action.sessionId);
    if (started?.sessionId) onOpenSession(started.sessionId);
    onSent();
  };

  // D-206: the streamed reply types out at reading pace (the phone's paceStep); the saved chat replaces it at the end.
  useEffect(() => {
    if (!live) return;
    if (live.finished && live.shown >= live.received.length) {
      const result = liveResult.current;
      liveResult.current = null;
      setLive(null);
      setSending(false);
      if (result) apply(result);
      return;
    }
    const step = paceStep(live.received, live.shown, live.finished);
    if (!step) return;
    const t = setTimeout(() => setLive(l => l && { ...l, shown: Math.max(l.shown, step.shown) }), step.delay);
    return () => clearTimeout(t);
  }, [live]);

  const sendText = async (text: string, timed?: TimedSize, consented = false) => {
    const content = text.trim();
    if (!content || sending) return;
    if (!aiConsent && !consented) {
      requireConsent('You sent a message to the coach. It needs your OK before anything is sent.', () => void sendText(text, timed, true));
      return;
    }
    setError('');
    setReportFor(null);
    setPending(content);
    setSending(true);
    const data: HomeChatInput = { content, version, utcOffsetMinutes: -new Date().getTimezoneOffset(), ...(courseId ? { courseId } : {}), ...(timed ? { timedExam: { size: timed } } : {}) };
    try {
      if (streamable(content, lastMessage)) {
        setLive({ received: '', shown: 0, finished: false });
        const result = await sendWithRetry(
          () => streamChatMessage(data, piece => setLive(l => l && { ...l, received: l.received + piece })),
          () => setLive({ received: '', shown: 0, finished: false }),
        );
        liveResult.current = result;
        setLive(l => l ? { ...l, finished: true } : { received: '', shown: 0, finished: true });
        return; // the pacing effect applies the result once the text has typed out
      }
      apply(await send.mutateAsync({ data }));
      setSending(false);
    } catch (problem) {
      setLive(null);
      setPending(null);
      setSending(false);
      if (problem instanceof AlreadySent || (problem as { status?: number }).status === 409) {
        void client.invalidateQueries({ queryKey: chatKey });
        if (!(problem instanceof AlreadySent)) setError(friendlyError(problem));
        return;
      }
      failed(problem);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void sendText(draft); };

  const reportReply = async (message: HomeChatMessage, reason: ReportReason) => {
    setReportFor(null);
    try {
      await report.mutateAsync({ data: { messageId: message.id, reason, ...(courseId ? { courseId } : {}) } });
      await client.invalidateQueries({ queryKey: chatKey });
      setToast('Thanks. The reply was reported and nothing in your chat changed.');
    } catch (problem) {
      setError(friendlyError(problem));
    }
  };
  useEffect(() => {
    if (!reportFor) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setReportFor(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reportFor]);

  const focusInput = () => inputRef.current?.focus();
  const busy = sending;
  // D-304: the set's card stays where the set started; the score and the coach's review come after it.
  const setCard = deckSessionId ? <FlashcardDeck key={deckSessionId} sessionId={deckSessionId}
      onFinished={finished => { setFinishedDeckId(finished.id); void sendText(FINISHED_DECK_MESSAGE); }}
      onError={failed} />
    : quizSessionId ? <QuizCard key={quizSessionId} sessionId={quizSessionId} passMark={passMark}
      onGraded={graded => { setGradedSessionId(graded.id); void sendText(FINISHED_SET_MESSAGE); }}
      onError={failed} />
    : null;
  const cardAnchor = deckSessionId ? setCardAnchor(messages, { kind: 'deck' }) : quizSessionId ? setCardAnchor(messages, { kind: 'quiz', sessionId: quizSessionId }) : null;
  // The timed-exam choices wait while the coach is answering or going over misses (its chips are Got it / Not yet).
  const showTimed = !busy && !activeQuiz && !activeDeck && !chips.includes('Got it');

  return <>
    <section className="rr-thread" aria-label="Conversation" data-testid="panel-home-chat">
      {chat.isLoading && <p className="rr-note">Loading your chat…</p>}
      {chat.error && <p className="rr-error" role="alert">Couldn’t load your chat. <button type="button" className="rr-quiet" onClick={() => void chat.refetch()}>Try again</button></p>}
      {!chat.isLoading && !messages.length && !pending && (
        <article className="rr-reply"><p>Hey. Which course or certification exam are we working on? Pick it above, or just tell me.</p></article>
      )}
      {messages.map(turn => <div key={turn.id} style={{ display: 'contents' }}>
        {turn.sessionStart && <p className="rr-session">New session</p>}
        {turn.role === 'user' ? <div className="rr-user" data-testid="chat-turn-user">{turn.content}</div> : (
          <article className="rr-reply" data-testid="chat-turn-assistant">
            <ReplyBody content={turn.content} onPopQuiz={focusInput} />
            {turn.actions?.map((action, i) => <p key={`${action.type}-${i}`} className="rr-note" data-testid={action.type === 'update_memory_sheet' ? 'card-memory-sheet' : action.type === 'fix_upload_notes' ? 'card-upload-notes-fix' : action.type === 'update_course_notes' || action.type === 'undo_course_notes' ? 'card-course-notes' : undefined}>
              {action.type === 'update_memory_sheet' ? 'Saved to your memory sheet'
                : action.type === 'fix_upload_notes' ? `Fixed your notes for ${action.name ?? 'that upload'}: ${action.summary ?? ''}`
                : action.type === 'update_course_notes' ? `Updated your notes: ${action.summary ?? ''}`
                : action.type === 'undo_course_notes' ? `Undid in your notes: ${action.summary ?? ''}`
                : action.type === 'create_course' ? `Added course: ${action.name ?? ''}`
                : action.type === 'start_quiz' ? `${action.kind === 'practice' ? 'Practice' : 'Exam'} set: ${action.count ?? ''} questions on ${[topicParts(action.topic ?? '').title, ...topicParts(action.topic ?? '').sections].join(' · ')}`
                : action.type === 'start_flashcards' ? `Flashcards: ${action.count ?? ''} cards on ${action.topic ?? ''}`
                : action.type === 'start_session' ? <>Started a session: {action.topic ?? ''}{action.sessionId && <> · <button type="button" className="rr-quiet" onClick={() => onOpenSession(action.sessionId!)} data-testid="button-open-session">Open</button></>}</>
                : null}
            </p>)}
            <div className="rr-reply-foot">
              {turn.reported ? <span className="rr-note" data-testid="chat-reported">Reported for review</span> : <>
                <button type="button" className="rr-quiet" aria-haspopup="menu" aria-expanded={reportFor === turn.id} onClick={() => setReportFor(reportFor === turn.id ? null : turn.id)} data-testid="button-report-reply">Report</button>
                {reportFor === turn.id && <div className="rr-menu" role="menu" aria-label="What is wrong with this reply?" data-testid="menu-report-reply">
                  <div className="rr-menu-title">What is wrong with this reply?</div>
                  {REPORT_REASONS.map(item => <button key={item.reason} type="button" role="menuitem" disabled={report.isPending} onClick={() => void reportReply(turn, item.reason)} data-testid={`button-report-${item.reason}`}>{item.label}</button>)}
                </div>}
              </>}
            </div>
          </article>
        )}
        {turn.id === cardAnchor && setCard}
      </div>)}
      {pending && <div className="rr-user" data-testid="chat-turn-pending">{pending}</div>}
      {live && <article className="rr-reply" aria-live="polite" data-testid="chat-turn-live">
        {live.shown === 0 ? <p className="rr-thinking">Coach is thinking…</p> : <ReplyBody content={closeOpenBold(live.received.slice(0, live.shown))} onPopQuiz={focusInput} caret />}
      </article>}
      {toast && <div className="rr-toast" role="status" data-testid="toast-reported">{toast}</div>}
      {chips.length > 0 && <div className="rr-suggestions" data-testid="row-suggestions">
        {chips.map(chip => <button key={chip} type="button" className="rr-chip" disabled={busy} onClick={() => (chip === REVIEW_CHIP && courseId ? openReview(courseId) : void sendText(chip))} data-testid={chip === REVIEW_CHIP ? 'button-suggestion-review' : 'button-suggestion'}>{chip}</button>)}
      </div>}
      {!cardAnchor && setCard}
      {sending && !live && <ProgressBar fraction={estimate(sendElapsed, 15_000)} label="Coach is working… writing questions can take up to a minute." testId="progress-coach" />}
      {error && <p className="rr-error" role="alert" data-testid="status-chat-error">{error}</p>}
      {showTimed && timedChoices.length === 0 && factPicks && onPickFacts && <div style={{ display: 'grid', gap: 8 }} data-testid="row-timed-picks">
        <span className="rr-note">Simulated exam, timed. The official page doesn't list these; pick yours:</span>
        <div className="rr-suggestions"><span className="rr-note">Questions</span>
          {factPicks.questions.map(n => <button key={n} type="button" aria-pressed={(pickQ ?? factPicks.question) === n} className="rr-course-chip" onClick={() => setPickQ(n)} data-testid={`button-pick-questions-${n}`}>{n}</button>)}</div>
        <div className="rr-suggestions"><span className="rr-note">Minutes</span>
          {factPicks.minutes.map(n => <button key={n} type="button" aria-pressed={(pickM ?? factPicks.minute) === n} className="rr-course-chip" onClick={() => setPickM(n)} data-testid={`button-pick-minutes-${n}`}>{n}</button>)}</div>
        {(() => { const q = pickQ ?? factPicks.question; const m = pickM ?? factPicks.minute; return <button type="button" className="rr-primary" disabled={busy || !q || !m}
          onClick={() => { if (q && m) void onPickFacts(q, m).then(() => sendText(`Timed exam: Full exam: ${q} questions · ${m} min`, 'full')); }} data-testid="button-timed-start-picked">{q && m ? `Start timed exam · ${q} questions · ${m} min` : 'Pick questions and minutes'}</button>; })()}
      </div>}
      {showTimed && timedChoices.length > 0 && <div className="rr-suggestions" data-testid="row-timed-exam">
        <span className="rr-note" style={{ alignSelf: 'center' }}>Simulated exam, timed:</span>
        {timedChoices.map(choice => <button key={choice.size} type="button" className="rr-chip" disabled={busy} onClick={() => void sendText(`Timed exam: ${choice.label}`, choice.size)} data-testid={`button-timed-${choice.size}`}>{choice.label}</button>)}
      </div>}
      <div ref={endRef} />
    </section>
    <form className="rr-composer" onSubmit={submit}>
      <label htmlFor="input-home-chat" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message your coach</label>
      <input id="input-home-chat" ref={inputRef} className="rr-input" placeholder="Ask anything, or say what to study" value={draft}
        onChange={event => setDraft(event.target.value)} maxLength={8000} disabled={busy} data-testid="input-home-chat" />
      <button type="submit" className="rr-primary" disabled={busy || !draft.trim()} data-testid="button-send-home-chat">Send</button>
    </form>
  </>;
}
