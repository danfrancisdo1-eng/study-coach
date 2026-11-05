import { useCallback, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPremiumStatusQueryKey, getGetStudyStateQueryKey, useGetPremiumStatus, useGetStudyState, usePutStudyState, useRefreshPremium, useSaveExamFacts,
  type StudyStateEnvelope,
} from '@workspace/api-client-react';
import { consentedState } from '@phone-lib/ai-consent';
import { courseExamFacts, factPicks, timedChoices } from '@phone-lib/exam-facts';
import { passMarkLine } from '@phone-lib/exam-sheet';
import { friendlyError } from '@phone-lib/friendly-error';
import AppShell from './AppShell';
import CoachChat from './CoachChat';
import { ConsentDialog, LimitDialog } from './Dialogs';
import { countdownText, planSummary, type PlanStatus, type PremiumCode } from '../lib/coach-ui';
import { coachParams } from '../lib/courses-ui';
import type { TimedSize } from '@phone-lib/exam-facts';

type Course = { id: string; name: string; kind?: string; examDate?: string } & Record<string, unknown>;

/** D-303: the web Coach screen (the mock Dan approved): course chips, the exam countdown, the chat, the live count. */
export default function CoachPage() {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const stateQuery = useGetStudyState();
  const premiumQuery = useGetPremiumStatus();
  const put = usePutStudyState();
  const refresh = useRefreshPremium();
  const saveExamFacts = useSaveExamFacts();
  // D-305: a course screen button opens Coach on its course and can carry one request to send (?course=&send=&timed=).
  const [initial] = useState(() => coachParams(window.location.search));
  const [courseId, setCourseId] = useState<string | null>(initial.courseId);
  const [autoSend, setAutoSend] = useState<{ text: string; timed?: TimedSize } | null>(initial.send ? { text: initial.send, ...(initial.timed ? { timed: initial.timed as TimedSize } : {}) } : null);
  const autoSent = useCallback(() => {
    setAutoSend(null);
    // Sent once: a reload of the page must not send it again.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [consent, setConsent] = useState<{ reason: string; run: () => void } | null>(null);
  const [consentError, setConsentError] = useState('');
  const [limit, setLimit] = useState<PremiumCode | null>(null);
  const runAfterConsent = useRef<(() => void) | null>(null);

  const envelope = stateQuery.data;
  const state = (envelope?.state ?? { aiConsent: false }) as Record<string, unknown> & { aiConsent?: boolean };
  const courses = (Array.isArray(state.courses) ? state.courses : []).filter((c): c is Course => !!c && typeof c.id === 'string' && typeof c.name === 'string');
  const focus = courses.find(c => c.id === courseId) ?? null;
  const status = (premiumQuery.data ?? null) as PlanStatus | null;
  const plan = premiumQuery.data ? planSummary(status) : null;
  const countdown = countdownText(focus);
  const facts = focus ? courseExamFacts(focus) : null;

  const refreshUsage = useCallback(() => { void client.invalidateQueries({ queryKey: getGetPremiumStatusQueryKey() }); }, [client]);
  const requireConsent = useCallback((reason: string, run: () => void) => { setConsentError(''); runAfterConsent.current = run; setConsent({ reason, run }); }, []);

  const agree = async () => {
    if (!envelope) return;
    setConsentError('');
    try {
      const result = await put.mutateAsync({ data: { state: consentedState(envelope.state, new Date().toISOString()) as never, version: envelope.version } });
      client.setQueryData<StudyStateEnvelope>(getGetStudyStateQueryKey(), result);
      const run = runAfterConsent.current;
      runAfterConsent.current = null;
      setConsent(null);
      run?.();
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) void stateQuery.refetch();
      setConsentError(friendlyError(problem));
    }
  };

  const checkAgain = async () => {
    try {
      const fresh = await refresh.mutateAsync({ data: {} });
      client.setQueryData(getGetPremiumStatusQueryKey(), fresh);
      if (fresh.plan === 'premium') setLimit(null);
    } catch { /* the dialog stays; the plan line shows what the server knows */ }
  };

  return <AppShell active="coach" plan={plan}>
    <header className="rr-top">
      <div className="rr-chips" role="group" aria-label="Course to study">
        <button type="button" className="rr-course-chip" aria-pressed={courseId === null} onClick={() => { setAutoSend(null); setCourseId(null); }} data-testid="button-focus-all">All courses</button>
        {courses.map(c => <button key={c.id} type="button" className="rr-course-chip" aria-pressed={c.id === courseId} onClick={() => { setAutoSend(null); setCourseId(c.id); }} data-testid="button-focus-course">{c.name}</button>)}
      </div>
      {countdown && <div className="rr-countdown" data-testid="text-countdown"><strong>{countdown.split(' · ')[0]}</strong> · {countdown.split(' · ').slice(1).join(' · ')}</div>}
      {plan?.count && <div className="rr-plan-inline">{plan.plan} · {plan.count}</div>}
    </header>
    {stateQuery.error ? <section className="rr-thread"><p className="rr-error" role="alert">{friendlyError(stateQuery.error)} <button type="button" className="rr-quiet" onClick={() => void stateQuery.refetch()}>Try again</button></p></section>
      : stateQuery.isLoading ? <section className="rr-thread"><p className="rr-note">Loading your courses…</p></section>
      : <CoachChat aiConsent={state.aiConsent === true} courseId={courseId}
        passMark={facts ? passMarkLine(facts.passingScore) : undefined}
        timedChoices={focus?.kind === 'exam' && facts ? timedChoices(facts) : []}
        factPicks={focus?.kind === 'exam' && facts ? factPicks(facts) : null}
        onPickFacts={async (questions, minutes) => { if (!focus || !facts) return; await saveExamFacts.mutateAsync({ courseId: focus.id, data: { questionCount: questions, durationMinutes: minutes, passingScore: facts.passingScore } }); await stateQuery.refetch(); }}
        onCoursesChanged={() => void client.invalidateQueries({ queryKey: getGetStudyStateQueryKey() })}
        onOpenSession={() => navigate('/desk')}
        requireConsent={requireConsent}
        onLimit={code => { setLimit(code); refreshUsage(); }}
        onSent={refreshUsage}
        autoSend={autoSend && courses.some(c => c.id === courseId) ? autoSend : null} onAutoSent={autoSent} />}
    {consent && <ConsentDialog reason={consent.reason} busy={put.isPending} error={consentError} onAgree={() => void agree()} onClose={() => { runAfterConsent.current = null; setConsent(null); }} />}
    {limit && <LimitDialog code={limit} status={status} checking={refresh.isPending} onCheckAgain={() => void checkAgain()} onClose={() => setLimit(null)} />}
  </AppShell>;
}
