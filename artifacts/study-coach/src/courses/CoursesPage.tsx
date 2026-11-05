import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudyStateQueryKey, useGetPremiumStatus, useGetStudyState, useListLectures, useListStudySessions, useLookupExamGuide, usePutStudyState,
  type StudyStateEnvelope,
} from '@workspace/api-client-react';
import { examDateHint } from '@phone-lib/exam-date';
import { friendlyError } from '@phone-lib/friendly-error';
import AppShell from '../coach/AppShell';
import { LimitDialog } from '../coach/Dialogs';
import { planSummary, premiumCode, type PlanStatus, type PremiumCode } from '../lib/coach-ui';
import { coachLink, courseRow, coursesOf, newCourse, newCourseId, type CourseKind } from '../lib/courses-ui';
import './courses.css';

/** D-305: the web Courses tab (the mock Dan approved): one row per course or exam, and Add. */
export default function CoursesPage() {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const stateQuery = useGetStudyState();
  const sessionsQuery = useListStudySessions();
  const lecturesQuery = useListLectures();
  const premiumQuery = useGetPremiumStatus();
  const put = usePutStudyState();
  const lookupGuide = useLookupExamGuide();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<CourseKind | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ id: string; name: string; kind: CourseKind } | null>(null);
  const [limit, setLimit] = useState<PremiumCode | null>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const envelope = stateQuery.data;
  const status = (premiumQuery.data ?? null) as PlanStatus | null;
  const sessions = sessionsQuery.data?.sessions ?? [];
  const lectures = lecturesQuery.data?.lectures ?? [];
  const rows = coursesOf(envelope?.state).map(c => courseRow(c, { materials: (envelope?.state as { materials?: unknown } | undefined)?.materials, sessions, lectures, readOnlyIds: status?.enforced ? premiumQuery.data?.readOnlyCourseIds : [] }));

  useEffect(() => { if (adding && !added) nameRef.current?.focus(); }, [adding, kind, added]);
  useEffect(() => {
    if (!adding) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [adding]);

  const close = () => { setAdding(false); setAdded(null); setKind(null); setName(''); setDate(''); setError(''); };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!envelope || put.isPending) return;
    const made = newCourse({ name, kind, date }, newCourseId());
    if ('error' in made) { setError(made.error); return; }
    setError('');
    const state = (envelope.state ?? {}) as Record<string, unknown>;
    try {
      // Adding a course never grants AI consent by itself (the phone's D-047).
      const result = await put.mutateAsync({ data: { state: { aiConsent: false, materials: [], ...state, courses: [...coursesOf(state), made.course] } as never, version: envelope.version } });
      client.setQueryData<StudyStateEnvelope>(getGetStudyStateQueryKey(), result);
      setAdded({ id: made.course.id, name: made.course.name, kind: made.course.kind });
      setName(''); setDate('');
      // An exam's official guide is looked up once it is added, when the AI agreement is already given.
      if (made.course.kind === 'exam' && state.aiConsent === true) {
        setLookingUp(made.course.id);
        lookupGuide.mutateAsync({ courseId: made.course.id }).then(() => client.invalidateQueries({ queryKey: getGetStudyStateQueryKey() })).catch(() => {}).finally(() => setLookingUp(null));
      }
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) void client.invalidateQueries({ queryKey: getGetStudyStateQueryKey() });
      const code = premiumCode(problem);
      if (code) { close(); setLimit(code); return; }
      setError(friendlyError(problem));
    }
  };

  return <AppShell active="courses" plan={premiumQuery.data ? planSummary(status) : null}>
    <div className="rr-page">
      <div className="rr-page-head">
        <h1 className="rr-title">Courses &amp; exams</h1>
        <button type="button" className="rr-primary rr-with-icon" onClick={() => setAdding(true)} data-testid="button-add-course"><Plus size={16} aria-hidden="true" />Add</button>
      </div>
      {stateQuery.error ? <p className="rr-error" role="alert">{friendlyError(stateQuery.error)} <button type="button" className="rr-quiet" onClick={() => void stateQuery.refetch()}>Try again</button></p>
        : stateQuery.isLoading ? <p className="rr-note">Loading your courses…</p>
        : rows.length ? <ul className="rr-list" data-testid="list-courses">
          {rows.map(row => <li key={row.id}>
            <Link href={`/courses/${encodeURIComponent(row.id)}`} className="rr-list-row" data-testid="row-course">
              <span className="rr-list-main"><strong>{row.name}</strong><span className="rr-note">{lookingUp === row.id ? `${row.detail} · looking up the exam guide…` : row.detail}</span></span>
              {row.readOnly ? <span className="rr-tag rr-tag--muted">Read-only</span> : row.countdown ? <span className="rr-tag">{row.countdown}</span> : null}
              <ChevronRight size={18} aria-hidden="true" className="rr-chevron" />
            </Link>
          </li>)}
        </ul>
        : <p className="rr-card rr-note" data-testid="text-no-courses">No courses yet. Add one here, or just tell the coach what you're studying.</p>}
      {rows.length > 0 && <p className="rr-note">Pick one to see its notes, results and exam info. To study it, open Coach and pick it there.</p>}
    </div>

    {adding && <div className="rr-shade" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      {!added ? <form className="rr-dialog" role="dialog" aria-modal="true" aria-labelledby="add-title" onSubmit={event => void add(event)} data-testid="dialog-add-course">
        <h2 id="add-title">Add a course or exam</h2>
        <p className="rr-reason">Is this a course or a certification exam?</p>
        <div className="rr-choice" role="radiogroup" aria-label="Kind">
          {(['course', 'exam'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className="rr-choice-item" onClick={() => setKind(k)} data-testid={`button-kind-${k}`}>{k === 'course' ? 'Course' : 'Certification exam'}</button>)}
        </div>
        {kind && <>
          <label className="rr-label" htmlFor="add-name">Name</label>
          <input id="add-name" ref={nameRef} className="rr-input" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder={kind === 'exam' ? 'e.g. AWS Solutions Architect Associate' : 'e.g. BIOL 114'} data-testid="input-add-name" />
          {kind === 'exam' && <>
            <label className="rr-label" htmlFor="add-date">Exam date (optional)</label>
            <input id="add-date" className="rr-input" value={date} onChange={event => setDate(event.target.value)} placeholder="e.g. Nov 14" data-testid="input-add-date" />
            {date.trim() && <span className="rr-note" data-testid="text-add-date-hint">{examDateHint(date)}</span>}
          </>}
        </>}
        {error && <p className="rr-error" role="alert">{error}</p>}
        <button type="submit" className="rr-primary rr-primary--wide" disabled={!kind || !name.trim() || put.isPending} data-testid="button-add-confirm">{put.isPending ? 'Adding…' : kind === 'exam' ? 'Add exam' : kind === 'course' ? 'Add course' : 'Add'}</button>
        <button type="button" className="rr-secondary" onClick={close}>Cancel</button>
      </form>
      : <div className="rr-dialog" role="dialog" aria-modal="true" aria-labelledby="next-title" data-testid="dialog-added">
        <h2 id="next-title">Added {added.name}. What next?</h2>
        <button type="button" className="rr-primary rr-primary--wide" onClick={() => navigate('/desk')} data-testid="button-next-material">{added.kind === 'course' ? 'Add your syllabus' : 'Add material'}</button>
        {added.kind === 'course' && <p className="rr-note">Every quiz and exam date, and what's covered.</p>}
        <button type="button" className="rr-outline" onClick={() => navigate(coachLink(added.id, { action: 'practiceNoMaterial' }))} data-testid="button-next-practice">Start practice questions</button>
        <button type="button" className="rr-outline" onClick={() => navigate(`/courses/${encodeURIComponent(added.id)}`)} data-testid="button-next-open">Go to {added.name}</button>
        <button type="button" className="rr-secondary" onClick={() => { setAdded(null); setKind(null); }}>Add another course</button>
        <button type="button" className="rr-secondary" onClick={close} data-testid="button-next-list">Return to course list</button>
      </div>}
    </div>}
    {limit && <LimitDialog code={limit} status={status} checking={false} onCheckAgain={() => { setLimit(null); void premiumQuery.refetch(); }} onClose={() => setLimit(null)} />}
  </AppShell>;
}
