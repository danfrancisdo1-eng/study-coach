import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteCourse, getGetStudyStateQueryKey, getListLecturesQueryKey, getListStudySessionsQueryKey,
  useCreateReviewSheet, useGetCourseResults, useGetPremiumStatus, useGetStudyState, useListStudySessions, useLookupExamGuide, usePutStudyState, useSaveExamFacts,
  type StudyStateEnvelope,
} from '@workspace/api-client-react';
import { blocksOf, type Span } from '@phone-lib/coach-text';
import { courseExamFacts, factsFromInputs, realExamLine, timedChoices } from '@phone-lib/exam-facts';
import { describeExamDate, examDateHint, parseExamDate } from '@phone-lib/exam-date';
import { friendlyError } from '@phone-lib/friendly-error';
import { masteryIsStrong, masteryLabel, masteryShare, masteryValue } from '@phone-lib/mastery';
import { courseConfirmWord, matchesCourseConfirmWord } from '@phone-lib/course-delete-confirm';
import AppShell from '../coach/AppShell';
import { LimitDialog } from '../coach/Dialogs';
import { useAiConsent } from '../coach/useAiConsent';
import { countdownText, planSummary, premiumCode, type PlanStatus, type PremiumCode } from '../lib/coach-ui';
import { coachLink, coursesOf, courseView, progressRows, safeLink } from '../lib/courses-ui';
import { openReviewTab } from '../lib/review-tab';
import './courses.css';

const inline = (spans: Span[]) => spans.map((sp, k) => sp.bold ? <strong key={k}>{sp.text}</strong> : <span key={k}>{sp.text}</span>);

/** Coach-written Markdown notes, read-only (D-119/D-123): headings, bullets, bold, as the phone's NotesView. */
function Notes({ text }: { text: string }) {
  return <div className="rr-notes">{blocksOf(text).map((block, i) => {
    if (block.kind === 'heading' || block.kind === 'section' || block.kind === 'tip') return <p key={i} className="rr-heading">{block.spans[0]?.text}</p>;
    if (block.kind === 'bullet') return <p key={i} className="rr-bullet">• {inline(block.spans)}</p>;
    return <p key={i}>{inline(block.spans)}</p>;
  })}</div>;
}

function Card({ title, aside, children, testId }: { title: string; aside?: ReactNode; children: ReactNode; testId: string }) {
  const id = `h-${testId}`;
  return <section className="rr-card" aria-labelledby={id} data-testid={testId}>
    <div className="rr-card-head"><h2 id={id} className="rr-kicker">{title}</h2>{aside}</div>
    {children}
  </section>;
}

/** D-305: the web course screen (the mock Dan approved). Study buttons open Coach on this course with the request. */
export default function CoursePage({ courseId }: { courseId: string }) {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const stateQuery = useGetStudyState();
  const sessionsQuery = useListStudySessions();
  const resultsQuery = useGetCourseResults(courseId);
  const premiumQuery = useGetPremiumStatus();
  const put = usePutStudyState();
  const lookupGuide = useLookupExamGuide();
  const saveFacts = useSaveExamFacts();
  const review = useCreateReviewSheet();
  const envelope = stateQuery.data;
  const { withConsent, dialog: consentDialog } = useAiConsent(envelope);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState<PremiumCode | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', questions: '', minutes: '', passing: '' });
  const [saving, setSaving] = useState(false);
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [timedOpen, setTimedOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');

  const view = courseView(envelope?.state, courseId);
  const course = view.course;
  const status = (premiumQuery.data ?? null) as PlanStatus | null;
  const plan = premiumQuery.data ? planSummary(status) : null;
  const facts = courseExamFacts(course ?? {});
  const results = resultsQuery.data;
  const progress = progressRows(sessionsQuery.data?.sessions ?? [], courseId);
  const readOnly = !!status?.enforced && !!premiumQuery.data?.readOnlyCourseIds.includes(courseId);
  const countdown = countdownText(course as { kind?: unknown; examDate?: unknown } | null);
  const failed = (problem: unknown) => { const code = premiumCode(problem); if (code) setLimit(code); else setError(friendlyError(problem)); };
  const go = (href: string) => navigate(href);

  if (stateQuery.isLoading) return <AppShell active="courses" plan={plan}><div className="rr-page"><p className="rr-note">Loading…</p></div></AppShell>;
  if (stateQuery.error) return <AppShell active="courses" plan={plan}><div className="rr-page"><p className="rr-error" role="alert">{friendlyError(stateQuery.error)}</p></div></AppShell>;
  if (!course) return <AppShell active="courses" plan={plan}><div className="rr-page">
    <Link href="/courses" className="rr-back"><ChevronLeft size={16} aria-hidden="true" />Courses</Link>
    <p className="rr-card">This course isn’t in your account anymore.</p>
  </div></AppShell>;

  const persist = async (courses: unknown[]) => {
    if (!envelope) throw new Error('Your account is still loading. Try again in a moment.');
    const state = (envelope.state ?? {}) as Record<string, unknown>;
    const result = await put.mutateAsync({ data: { state: { ...state, aiConsent: state.aiConsent === true, courses } as never, version: envelope.version } });
    client.setQueryData<StudyStateEnvelope>(getGetStudyStateQueryKey(), result);
  };
  const openEditor = () => {
    setForm({ name: course.name, date: typeof course.examDate === 'string' ? describeExamDate(course.examDate) : '', questions: facts.questionCount ? String(facts.questionCount) : '', minutes: facts.durationMinutes ? String(facts.durationMinutes) : '', passing: facts.passingScore });
    setError('');
    setEditing(true);
  };
  // The phone's saveDetails: name and exam date in the state; typed exam facts saved only when they differ.
  const saveDetails = async () => {
    const name = form.name.trim();
    if (!name || saving) return;
    const iso = view.isExam ? parseExamDate(form.date) : null;
    if (view.isExam && form.date.trim() && !iso) { setError('Try the exam date like Nov 14 or 11/14/2026.'); return; }
    const typed = view.isExam ? factsFromInputs(form.questions, form.minutes, form.passing) : null;
    if (typed && 'error' in typed) { setError(typed.error); return; }
    setError(''); setSaving(true);
    try {
      await persist(coursesOf(envelope?.state).map(c => c.id === courseId ? { ...c, name: name.slice(0, 120), ...(view.isExam ? { examDate: iso ?? undefined } : {}) } : c));
      if (typed && 'facts' in typed) {
        const t = typed.facts;
        if (t.questionCount !== facts.questionCount || t.durationMinutes !== facts.durationMinutes || t.passingScore !== facts.passingScore) {
          await saveFacts.mutateAsync({ courseId, data: t });
          await client.invalidateQueries({ queryKey: getGetStudyStateQueryKey() });
        }
      }
      setEditing(false);
    } catch (problem) {
      if ((problem as { status?: number }).status === 409) void stateQuery.refetch();
      setError(friendlyError(problem));
    } finally { setSaving(false); }
  };
  const refreshGuide = () => withConsent('Looking up this exam uses AI. Say OK once and the coach works everywhere in the app.', () => {
    setError('');
    lookupGuide.mutateAsync({ courseId }).then(() => client.invalidateQueries({ queryKey: getGetStudyStateQueryKey() }), failed);
  });
  const removeCourse = async () => {
    if (!matchesCourseConfirmWord(confirm, course.name)) return;
    setError(''); setSaving(true);
    try {
      const result = await deleteCourse(courseId);
      client.setQueryData<StudyStateEnvelope>(getGetStudyStateQueryKey(), { state: result.state, version: result.version } as StudyStateEnvelope);
      await client.invalidateQueries({ queryKey: getListStudySessionsQueryKey() });
      await client.invalidateQueries({ queryKey: getListLecturesQueryKey() });
      navigate('/courses');
    } catch (problem) { setError(friendlyError(problem)); } finally { setSaving(false); }
  };
  const choices = view.isExam ? timedChoices(facts) : [];

  return <AppShell active="courses" plan={plan}>
    <div className="rr-page rr-page--wide">
      <Link href="/courses" className="rr-back" data-testid="link-back-courses"><ChevronLeft size={16} aria-hidden="true" />Courses</Link>
      <header className="rr-page-head rr-page-head--end">
        <div className="rr-stack-tight">
          <span className="rr-kicker">{view.isExam ? `Certification exam${typeof course.examDate === 'string' ? ` · ${describeExamDate(course.examDate)}` : ''}` : 'Course'}</span>
          <h1 className="rr-title" data-testid="text-course-name">{course.name}</h1>
        </div>
        <div className="rr-row">
          {countdown && <span className="rr-tag" data-testid="text-course-countdown">{countdown.split(' · ')[0]}</span>}
          <button type="button" className="rr-outline" onClick={openEditor} aria-expanded={editing} data-testid="button-edit-course">{view.isExam ? 'Edit name, date, exam facts' : 'Edit name'}</button>
        </div>
      </header>
      {error && <p className="rr-error" role="alert" data-testid="status-course-error">{error}</p>}

      {editing && <form className="rr-card rr-form" onSubmit={event => { event.preventDefault(); void saveDetails(); }} data-testid="form-edit-course">
        <label className="rr-label" htmlFor="edit-name">Name</label>
        <input id="edit-name" className="rr-input" value={form.name} maxLength={120} onChange={e => setForm({ ...form, name: e.target.value })} />
        {view.isExam && <>
          <label className="rr-label" htmlFor="edit-date">Exam date</label>
          <input id="edit-date" className="rr-input" value={form.date} placeholder="e.g. Nov 14" onChange={e => setForm({ ...form, date: e.target.value })} />
          {form.date.trim() && <span className="rr-note">{examDateHint(form.date)}</span>}
          <span className="rr-label">Real exam</span>
          <div className="rr-grid3">
            <label className="rr-note" htmlFor="edit-q">Questions<input id="edit-q" className="rr-input" inputMode="numeric" value={form.questions} onChange={e => setForm({ ...form, questions: e.target.value })} /></label>
            <label className="rr-note" htmlFor="edit-m">Minutes<input id="edit-m" className="rr-input" inputMode="numeric" value={form.minutes} onChange={e => setForm({ ...form, minutes: e.target.value })} /></label>
            <label className="rr-note" htmlFor="edit-p">Pass mark<input id="edit-p" className="rr-input" value={form.passing} onChange={e => setForm({ ...form, passing: e.target.value })} /></label>
          </div>
          <span className="rr-note">From the official exam page. Used to time full exam simulations.</span>
        </>}
        <div className="rr-row">
          <button type="submit" className="rr-primary" disabled={saving || !form.name.trim()} data-testid="button-save-course">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="rr-outline" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>}

      {readOnly && <p className="rr-card rr-note" data-testid="panel-read-only">Read-only on the free plan. Your materials, results and chats are all kept; studying it with the coach needs Premium, bought in the iPhone app.</p>}

      <div className="rr-columns">
        <div className="rr-column">
          {view.syllabus !== null || !view.isExam ? <Card title="Syllabus" testId="panel-syllabus">
            {view.syllabus ? <><p data-testid="text-syllabus-next">{view.syllabus.nextLine}</p><span className="rr-note">{view.syllabus.name}</span></>
              : <p>Add your syllabus. It gives the coach every quiz and exam date, and what's covered. <Link href="/desk">Add it here</Link>.</p>}
          </Card> : null}

          <Card title="Study with the coach" testId="panel-course-actions">
            <button type="button" className="rr-primary rr-primary--wide" disabled={readOnly} onClick={() => go(coachLink(courseId, { action: view.uploads.length ? 'practice' : 'practiceNoMaterial' }))} data-testid="button-action-practice">Practice questions</button>
            <div className="rr-grid2">
              {view.isExam && <button type="button" className="rr-outline" disabled={readOnly} aria-expanded={timedOpen} onClick={() => choices.length ? setTimedOpen(!timedOpen) : go(coachLink(courseId))} data-testid="button-action-exam">Simulated exam, timed</button>}
              <button type="button" className="rr-outline" disabled={readOnly} onClick={() => go(coachLink(courseId, { action: 'flashcards' }))} data-testid="button-action-flashcards">Flashcards</button>
              <button type="button" className="rr-outline" disabled={readOnly} onClick={() => go(coachLink(courseId, { action: 'hooks' }))} data-testid="button-action-hooks">Memory tips</button>
              <button type="button" className="rr-outline" disabled={readOnly} onClick={() => go(coachLink(courseId, { action: 'outline' }))} data-testid="button-action-outline">Outline of topics</button>
              <button type="button" className={view.isExam ? "rr-outline rr-span2" : "rr-outline"} disabled={readOnly || review.isPending} onClick={() => withConsent('The review sheet is written by AI. Say OK once and the coach works everywhere in the app.', () => openReviewTab(() => review.mutateAsync({ courseId }), failed))} data-testid="button-action-review">Review sheet (PDF)</button>
            </div>
            {timedOpen && choices.length > 0 && <div className="rr-suggestions" data-testid="row-course-timed">
              {choices.map(choice => <button key={choice.size} type="button" className="rr-chip" onClick={() => go(coachLink(courseId, { text: `Timed exam: ${choice.label}`, timed: choice.size }))} data-testid={`button-course-timed-${choice.size}`}>{choice.label}</button>)}
            </div>}
            {!view.uploads.length && <p className="rr-note">Recommended: upload your material first for the best results.</p>}
            <p className="rr-note">Each button opens Coach on this {view.isExam ? 'exam' : 'course'} and asks for it.</p>
          </Card>

          <Card title={`Topics tested · ${results?.topics.length ?? 0}`} aside={results?.topics.length ? <span className="rr-kicker">right / asked</span> : null} testId="panel-topic-history">
            {resultsQuery.isLoading && <p className="rr-note">Loading…</p>}
            {(results?.topics ?? []).map(t => { const right = t.total - t.missed; return <div key={t.topic} className="rr-stat" aria-label={masteryLabel(t.topic, right, t.total)} data-testid="row-topic-tested">
              <span className="rr-stat-label">{t.topic}</span><span className="rr-num">{masteryValue(right, t.total)}</span>
              <span className="rr-bar" aria-hidden="true"><span className={masteryIsStrong(right, t.total) ? 'rr-bar-fill' : 'rr-bar-fill rr-bar-fill--weak'} style={{ width: `${Math.round(masteryShare(right, t.total) * 100)}%` }} /></span>
            </div>; })}
            {results && !results.topics.length && <p className="rr-note">Nothing graded yet. Practice questions or a simulated exam will fill this in.</p>}
          </Card>

          {results?.weak.length ? <Card title="Coach recommends" testId="panel-coach-recommends">
            <p className="rr-note">Missed the last time they came up. Pick one for a practice set on it.</p>
            <div className="rr-suggestions">{results.weak.map(concept => <button key={concept} type="button" className="rr-chip" disabled={readOnly} onClick={() => go(coachLink(courseId, { action: 'practice', topic: concept }))} data-testid="button-weak-topic">{concept}</button>)}</div>
          </Card> : null}

          <Card title={`Progress · ${progress.count} ${progress.count === 1 ? 'set' : 'sets'}`} testId="panel-progress">
            {progress.rows.map(r => <div key={r.id} className="rr-stat rr-stat--plain"><span className="rr-stat-label"><span className="rr-note">{r.when}</span><br />{r.topic}</span><strong className="rr-num">{r.score}</strong></div>)}
            <p className="rr-note">{progress.missedLine}</p>
          </Card>
        </div>

        <div className="rr-column">
          {view.isExam && <Card title="Official exam guide" aside={<button type="button" className="rr-outline rr-small" disabled={lookupGuide.isPending} onClick={refreshGuide} data-testid="button-refresh-guide">{view.guide ? 'Refresh' : 'Look up'}</button>} testId="panel-exam-guide">
            {realExamLine(facts) && <p data-testid="text-real-exam">{realExamLine(facts)}</p>}
            {lookupGuide.isPending ? <p className="rr-note">Searching for the official guide…</p>
              : view.guide?.found ? <>
                {view.guide.sections.map((sec, i) => <div key={i} className="rr-stat rr-stat--plain"><span className="rr-stat-label">{sec.name}</span><span className="rr-num">{sec.weight}</span></div>)}
                {safeLink(view.guide.sourceUrl) && <p className="rr-note">Source: <a href={safeLink(view.guide.sourceUrl)!} target="_blank" rel="noreferrer noopener">{view.guide.sourceUrl}</a></p>}
                {view.guide.notes && <p className="rr-note">{view.guide.notes}</p>}
              </>
              : view.guide ? <p className="rr-note">No official guide was found{view.guide.notes ? `: ${view.guide.notes}` : ''}. The coach uses its own knowledge of the exam.</p>
              : <p className="rr-note">Look up the published sections and weights so topics and sets match the real exam.</p>}
          </Card>}

          <Card title="Course notes" testId="panel-course-notes">
            {view.notes.trim() ? <><Notes text={view.notes} /><p className="rr-note">To change something, tell the coach in this {view.isExam ? 'exam' : 'course'}'s chat. <Link href={coachLink(courseId)}>Open the chat</Link></p></>
              : <p className="rr-note">Tell the coach about dates and changes ("quiz 9 moved to Nov 5") and it keeps them here.</p>}
          </Card>

          <Card title={`Memory sheet · ${view.memory.length}`} testId="panel-memory-sheet">
            {view.memory.length ? view.memory.map(row => <div key={row.id} className="rr-hook">
              <strong>{row.term}</strong>{row.trick && <p>{row.trick}</p>}
              {(row.whenYouSee || row.think) && <p className="rr-small-text">When you see {row.whenYouSee} → think {row.think}</p>}
            </div>) : <p className="rr-note">Fills itself from the questions you miss. Ask the coach "Quiz me from my memory sheet" any time.</p>}
          </Card>

          <Card title={`Material · ${view.uploads.length + view.lectures.length}`} aside={<Link href="/desk" className="rr-outline rr-small rr-linkbutton" data-testid="link-add-material">+ Add</Link>} testId="panel-materials">
            {[...view.uploads, ...view.lectures].map(m => <div key={m.id} className="rr-material">
              <div className="rr-stat rr-stat--plain"><span className="rr-stat-label">{m.name}</span>
                {m.notes ? <button type="button" className="rr-quiet" aria-expanded={openNotes === m.id} onClick={() => setOpenNotes(openNotes === m.id ? null : m.id)} data-testid="button-show-notes">{openNotes === m.id ? 'Hide notes' : 'Show notes'}</button> : <span className="rr-note">No notes yet</span>}</div>
              {openNotes === m.id && m.notes && <Notes text={m.notes} />}
            </div>)}
            {!view.uploads.length && !view.lectures.length && <p className="rr-note">No material yet.</p>}
            <p className="rr-note">The coach turns each upload into notes. Uploads open on the account page for now.</p>
          </Card>

          <Card title="Delete" testId="panel-delete-course">
            {!deleting ? <button type="button" className="rr-quiet rr-danger" onClick={() => setDeleting(true)} data-testid="button-delete-course">Delete this {view.isExam ? 'exam' : 'course'}…</button> : <>
              <p className="rr-note">This deletes {course.name} with its material, chats and results. Type <strong>{courseConfirmWord(course.name)}</strong> to confirm.</p>
              <input className="rr-input" aria-label={`Type ${courseConfirmWord(course.name)} to confirm`} value={confirm} onChange={e => setConfirm(e.target.value)} data-testid="input-delete-confirm" />
              <div className="rr-row">
                <button type="button" className="rr-danger-button" disabled={saving || !matchesCourseConfirmWord(confirm, course.name)} onClick={() => void removeCourse()} data-testid="button-delete-confirm">Delete</button>
                <button type="button" className="rr-outline" onClick={() => { setDeleting(false); setConfirm(''); }}>Cancel</button>
              </div>
            </>}
          </Card>
        </div>
      </div>
    </div>
    {consentDialog}
    {limit && <LimitDialog code={limit} status={status} checking={false} onCheckAgain={() => { setLimit(null); void premiumQuery.refetch(); }} onClose={() => setLimit(null)} />}
  </AppShell>;
}
