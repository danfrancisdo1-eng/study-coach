import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, FileText, Pencil, Plus, Send, ShieldCheck, UploadCloud, X } from 'lucide-react';
import './account-experience.css';
import { factsFromInputs, realExamLine, type ExamFacts } from './lib/exam-facts';

/** Exact once-per-session materials questions; the parent persists when it has been answered. */
export const MATERIALS_CHECK_PROMPT = 'Do you have any course materials you want to add?';
export const MORE_MATERIALS_CHECK_PROMPT = 'Anything else before we start?';

export type AccountCourse = { id: string; name: string; code?: string };
export type SessionTurn = {
  id: string;
  role: 'coach' | 'student';
  text: string;
  kind?: 'teaching' | 'question' | 'feedback' | 'message';
  /** Human-readable source names/locations, supplied by the server. */
  sources?: string[];
};
export type MaterialExtraction = {
  id: string;
  filename: string;
  status: 'queued' | 'extracting' | 'ready' | 'error';
  detail?: string;
};
export type SessionQuestion = {
  id: string; prompt: string; options: string[]; source?: string;
  flag?: { kind: 'invalid' | 'ambiguous' | 'wrong_answer'; reason: string | null; reportedAt: string; recheck?: unknown } | null;
};
export type QuestionFeedback = {
  questionId: string;
  result: 'correct' | 'partial' | 'incorrect';
  explanation: string;
  teaching?: string;
  /** Optional descriptive feedback from grading, not a fabricated correct answer. */
  answerNote?: string;
};
export type ReviewItem = { id: string; concept: string; dueLabel?: string; note?: string };

/**
 * Controlled authenticated study-session surface. Parent owns the authenticated identity,
 * persisted courses/turns/answers, transitions, grading, consent and API calls. Render this
 * inside the existing app shell; no endpoint or local storage is used here.
 */
export type AccountExperienceProps = {
  courses: AccountCourse[];
  selectedCourseId: string | null;
  phase: 'setup' | 'conversation' | 'quiz' | 'grading' | 'review';
  sessionStarted: boolean;
  /** 'pending' is shown only once per session; parent advances to 'adding' or 'complete'. */
  materialsCheck: 'pending' | 'adding' | 'complete';
  aiConsent: boolean;
  materials: MaterialExtraction[];
  turns: SessionTurn[];
  questions: SessionQuestion[];
  qualityNotice?: string;
  invalidItemCount?: number;
  flaggedQuestionIds?: string[];
  /** A missing key means unanswered; index 0 is a valid answer. */
  answers: Record<string, number>;
  /** Parent-persisted assistance flags, independent of answer selection and grading. */
  assistedAnswers?: Record<string, boolean>;
  /** Latest actual coach reply to a quiz interruption, when available. */
  quizTutorReply?: SessionTurn | null;
  feedback: QuestionFeedback[];
  reviewSchedule: ReviewItem[];
  /** Optional result text from the grader. Never calculated by this component. */
  resultSummary?: string;
  /** True for a newly generated retest rather than reusing the previous questions. */
  isRetest?: boolean;
  busy?: boolean;
  error?: string | null;
  onSelectCourse: (courseId: string) => void;
  onCreateCourse: (name: string, kind: 'course' | 'exam', examDate?: string) => void;
  onRenameCourse: (courseId: string, name: string) => void;
  /** Saved materials per course id, shown while a course is being edited. */
  savedMaterialsByCourse?: Record<string, { id: string; name: string; notes?: string; lecture?: boolean }[]>;
  /** Official exam-guide per course id (certification exams), shown while editing. */
  examGuides?: Record<string, { found?: boolean; sections?: { name: string; weight: number | null }[]; sourceUrl?: string | null; questionCount?: number | null; durationMinutes?: number | null; passingScore?: string } | null>;
  /** Memory-sheet rows per course (D-025). */
  memorySheets?: Record<string, { id: string; term: string; trick: string; whenYouSee: string; think: string }[]>;
  /** Course notes per course (D-123): written by the coach, read-only here. */
  courseNotes?: Record<string, string>;
  onRefreshExamGuide?: (courseId: string) => void;
  /** The real exam's facts per course (typed first, then the guide's; D-111), and saving a correction. */
  examFacts?: Record<string, ExamFacts>;
  onSaveExamFacts?: (courseId: string, facts: ExamFacts) => void;
  onDeleteMaterial?: (materialId: string) => void;
  onDeleteCourse?: (courseId: string) => void;
  onStartSession: (courseId: string) => void;
  onMaterialsChoice: (choice: 'add' | 'skip') => void;
  onUploadMaterials: (files: File[]) => void;
  onContinueMaterials: () => void;
  onConsentChange: (consented: boolean) => void;
  onSendTurn: (text: string) => void;
  onReadyForQuiz: () => void;
  onSelectAnswer: (questionId: string, optionIndex: number) => void;
  onFlagQuestion?: (questionId: string, kind: 'invalid' | 'ambiguous', reason: string) => void;
  onAskDuringQuiz?: (questionId: string, text: string) => void;
  onMarkAssisted?: (questionId: string, assisted: boolean) => void;
  onSubmitQuiz: () => void;
  onRequestRetest: () => void;
  onRetry: () => void;
};

const statusLabels: Record<MaterialExtraction['status'], string> = {
  queued: 'Waiting to extract',
  extracting: 'Extracting text',
  ready: 'Text ready',
  error: 'Could not extract text',
};

export function AccountExperience(props: AccountExperienceProps) {
  const {
    courses, selectedCourseId, phase, sessionStarted, materialsCheck, aiConsent, materials,
    turns, questions, answers, assistedAnswers, qualityNotice, invalidItemCount = 0, flaggedQuestionIds = [],
    quizTutorReply, feedback, reviewSchedule, resultSummary, isRetest,
    busy = false, error, onSelectCourse, onCreateCourse, onRenameCourse, onStartSession, examGuides = {}, onRefreshExamGuide, examFacts = {}, onSaveExamFacts, memorySheets = {}, courseNotes = {},
    savedMaterialsByCourse = {}, onDeleteMaterial, onDeleteCourse,
    onMaterialsChoice, onUploadMaterials, onContinueMaterials, onConsentChange, onSendTurn,
    onReadyForQuiz, onSelectAnswer, onFlagQuestion, onAskDuringQuiz, onMarkAssisted, onSubmitQuiz, onRequestRetest,
    onRetry,
  } = props;
  const [newCourse, setNewCourse] = useState('');
  const [newKind, setNewKind] = useState<'course' | 'exam' | ''>(''); // D-158: no default; the student picks
  const [newExamDate, setNewExamDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [draft, setDraft] = useState('');
  const [quizDraft, setQuizDraft] = useState('');
  const [flagKind, setFlagKind] = useState<'invalid' | 'ambiguous'>('invalid');
  const [flagReasons, setFlagReasons] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const selected = courses.find(course => course.id === selectedCourseId);
  const currentIndex = Math.min(questionIndex, Math.max(questions.length - 1, 0));
  const currentQuestion = questions[currentIndex];
  const flagged = new Set(flaggedQuestionIds);
  const answerableQuestions = questions.filter(question => !flagged.has(question.id));
  const answered = answerableQuestions.filter(question => answers[question.id] !== undefined).length;
  const canSubmit = questions.length > 0 && answered === answerableQuestions.length && !busy;
  const canStart = !!selected && aiConsent && !busy;
  const status = phase === 'grading' ? 'Checking answers' : phase === 'quiz' ? 'Practice in progress' :
    sessionStarted ? 'Session in progress' : 'Ready when you are';

  function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCourse.trim();
    if (!name || busy) return;
    if (!newKind) return;
    onCreateCourse(name, newKind, newKind === 'exam' && newExamDate ? newExamDate : undefined);
    setNewCourse(''); setNewExamDate(''); setNewKind('');
  }
  function saveCourse(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const name = editName.trim();
    if (!name || busy) return;
    onRenameCourse(id, name);
    setEditingId(null);
  }
  function sendTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || !aiConsent) return;
    onSendTurn(text);
    setDraft('');
  }
  function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) onUploadMaterials(files);
    event.target.value = '';
  }
  function askDuringQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = quizDraft.trim();
    if (!text || !currentQuestion || busy || !aiConsent || !onAskDuringQuiz) return;
    onAskDuringQuiz(currentQuestion.id, text);
    setQuizDraft('');
  }

  return <section className="account-experience" aria-label="Study session" data-testid="account-study-session">
    <header className="ae-header">
      <div className="ae-header-copy">
        <span className="ae-kicker">YOUR STUDY SPACE / SESSION</span>
        <h1 className="ae-title">Let’s work it through.</h1>
        <p className="ae-muted ae-intro">Start with an explanation, ask what you need, then practice until the idea sticks. Your work can pick up across your signed-in devices.</p>
      </div>
      <span className="ae-state" data-testid="status-session">{status}</span>
    </header>
    {error && <div className="ae-callout ae-callout--error" role="alert" data-testid="status-session-error" style={{ marginTop: 20 }}>
      <strong>Something interrupted this step.</strong><p>{error}</p>
      <button type="button" className="ae-button ae-button--outline" onClick={onRetry} disabled={busy} data-testid="button-retry-session" style={{ marginTop: 10 }}>Try again</button>
    </div>}
    <div className="ae-grid">
      <div className="ae-main">
        {phase === 'setup' && <>
          <div className="ae-card" data-testid="panel-course-chooser">
            <div className="ae-card-top"><div><span className="ae-kicker">01 / COURSE</span><h2 className="ae-heading">What are we studying?</h2></div><BookOpen size={26} strokeWidth={1.5} aria-hidden="true" /></div>
            {courses.length ? <div className="ae-course-list" role="group" aria-label="Choose a course">
              {courses.map(course => <div className={`ae-course ${course.id === selectedCourseId ? 'is-active' : ''}`} key={course.id} data-testid={`row-course-${course.id}`}>
                {editingId === course.id ? <><form className="ae-row" onSubmit={event => saveCourse(event, course.id)} style={{ width: '100%' }}>
                  <input className="ae-input" aria-label={`Rename ${course.name}`} value={editName} onChange={event => setEditName(event.target.value)} maxLength={120} required style={{ flex: 1, minWidth: 150 }} data-testid={`input-rename-course-${course.id}`} />
                  <button type="submit" className="ae-button ae-button--ink" disabled={busy || !editName.trim()} data-testid={`button-save-course-${course.id}`}>Save</button>
                  <button type="button" className="ae-button ae-button--quiet" onClick={() => setEditingId(null)} data-testid={`button-cancel-rename-${course.id}`} aria-label="Cancel rename"><X size={16} /></button>
                </form>
                  {(course as { kind?: string }).kind === 'exam' && <div className="ae-course-manage" style={{ width: '100%', marginTop: 10 }} data-testid={`panel-exam-guide-${course.id}`}>
                    <p className="ae-kicker">Official exam guide {onRefreshExamGuide && <button type="button" className="ae-button ae-button--quiet" disabled={busy} onClick={() => onRefreshExamGuide(course.id)} data-testid={`button-refresh-guide-${course.id}`}>{examGuides[course.id] ? 'Refresh' : 'Look up'}</button>}</p>
                    {examGuides[course.id]?.found ? <>
                      {(examGuides[course.id]?.sections ?? []).map((s, i) => <div className="ae-row" key={i} style={{ justifyContent: 'space-between' }}><span>{s.name}</span><span className="ae-muted">{s.weight !== null ? `${s.weight}%` : ''}</span></div>)}
                      {examGuides[course.id]?.sourceUrl && <p className="ae-muted" style={{ fontSize: '.8rem' }}>Source: {examGuides[course.id]?.sourceUrl}</p>}
                    </> : examGuides[course.id] ? <p className="ae-muted">No official guide found; the coach uses its own knowledge of the exam.</p> : <p className="ae-muted">Not looked up yet.</p>}
                    {realExamLine(examFacts[course.id]) && <p data-testid={`text-real-exam-${course.id}`}>{realExamLine(examFacts[course.id])}</p>}
                    {onSaveExamFacts && <ExamFactsForm key={JSON.stringify(examFacts[course.id] ?? null)} courseId={course.id} facts={examFacts[course.id]} busy={busy} onSave={facts => onSaveExamFacts(course.id, facts)} />}
                  </div>}
                  {(courseNotes[course.id] ?? '').trim() && <div className="ae-course-manage" style={{ width: '100%', marginTop: 10 }} data-testid={`panel-course-notes-${course.id}`}>
                    <p className="ae-kicker">Course notes</p>
                    {courseNotes[course.id]!.split('\n').filter(line => line.trim()).map((line, i) => /^#+\s/.test(line)
                      ? <p key={i} style={{ fontWeight: 700 }}>{line.replace(/^#+\s*/, '')}</p>
                      : <p key={i}>{line.replace(/^\s*[-*]\s+/, '• ')}</p>)}
                    <p className="ae-muted" style={{ fontSize: '.8rem' }}>To change something, tell the coach in this course's chat.</p>
                  </div>}
                  {(memorySheets[course.id] ?? []).length > 0 && <div className="ae-course-manage" style={{ width: '100%', marginTop: 10 }} data-testid={`panel-memory-sheet-${course.id}`}>
                    <p className="ae-kicker">Memory sheet · {memorySheets[course.id]!.length}</p>
                    <div className="sc-sheet">{memorySheets[course.id]!.map(row => <div className="sc-sheet-row" key={row.id}>
                      <strong>{row.term}</strong>
                      <span className="sc-miss-hook">⚡ {row.trick}</span>
                      {(row.whenYouSee || row.think) && <span className="ae-muted" style={{ fontSize: '.8rem' }}>When you see {row.whenYouSee} → think {row.think}</span>}
                    </div>)}</div>
                  </div>}
                  {(onDeleteMaterial || onDeleteCourse) && <div className="ae-course-manage" style={{ width: '100%', marginTop: 10 }} data-testid={`panel-manage-course-${course.id}`}>
                    <p className="ae-kicker">Materials in this course</p>
                    {(savedMaterialsByCourse[course.id] ?? []).length === 0 && <p className="ae-muted">No saved materials yet.</p>}
                    {(savedMaterialsByCourse[course.id] ?? []).map(material => <div className="ae-row" key={material.id} style={{ justifyContent: 'space-between' }} data-testid={`row-material-${material.id}`}>
                      <details style={{ flex: 1 }} data-testid={`details-material-notes-${material.id}`}>
                        <summary>{material.name}</summary>
                        {material.notes ? <div style={{ padding: '6px 0 6px 12px' }}>
                          {material.notes.split('\n').filter(line => line.trim()).map((line, i) => /^#{1,6}\s/.test(line)
                            ? <p key={i} style={{ fontWeight: 700, margin: '8px 0 2px' }}>{line.replace(/^#+\s*/, '')}</p>
                            : <p key={i} style={{ margin: '2px 0' }}>{line.replace(/^\s*[-*]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1')}</p>)}
                          <p className="ae-muted" style={{ fontSize: '.8rem' }}>Anything wrong? Tell the coach in this course's chat.</p>
                        </div> : <p className="ae-muted" style={{ fontSize: '.85rem' }}>The coach writes these notes the next time you use this course's chat.</p>}
                      </details>
                      {onDeleteMaterial && !material.lecture && <button type="button" className="ae-button ae-button--quiet" disabled={busy} style={{ color: 'var(--destructive, #b33b2d)' }}
                        onClick={() => { if (window.confirm(`Delete “${material.name}”? Tutoring and quizzes for ${course.name} will stop using it. This can’t be undone.`)) onDeleteMaterial(material.id); }}
                        data-testid={`button-delete-material-${material.id}`}>Delete</button>}
                    </div>)}
                    {onDeleteCourse && <button type="button" className="ae-button ae-button--quiet" disabled={busy} style={{ color: 'var(--destructive, #b33b2d)', marginTop: 8 }}
                      onClick={() => {
                        // Same rule as the iPhone app (study-coach-mobile/lib/course-delete-confirm.ts): type the first word of the name.
                        const confirmWord = course.name.trim().split(/\s+/)[0] ?? '';
                        const typed = window.prompt(`This permanently deletes ${course.name} with its materials, study sessions, quiz history, review items and lectures. It can’t be undone.\n\nType “${confirmWord}” to confirm:`);
                        if (typed !== null && confirmWord !== '' && typed.trim().toLowerCase() === confirmWord.toLowerCase()) { setEditingId(null); onDeleteCourse(course.id); }
                        else if (typed !== null) window.alert('That didn’t match, so nothing was deleted.');
                      }}
                      data-testid={`button-delete-course-${course.id}`}>Delete course…</button>}
                  </div>}
                </> : <>
                  <button type="button" className="ae-course-pick" aria-pressed={course.id === selectedCourseId} onClick={() => onSelectCourse(course.id)} disabled={busy || sessionStarted} data-testid={`button-select-course-${course.id}`}>
                    {course.name}{course.code && <small>{course.code}</small>}
                  </button>
                  {!sessionStarted && <button type="button" className="ae-button ae-button--quiet" onClick={() => { setEditingId(course.id); setEditName(course.name); }} aria-label={`Edit ${course.name}`} data-testid={`button-edit-course-${course.id}`}><Pencil size={15} /></button>}
                </>}
              </div>)}
            </div> : <p className="ae-muted" data-testid="text-no-courses">No courses yet. Add the class you want to study first.</p>}
            {!sessionStarted && <form className="ae-row" onSubmit={createCourse}>
              <label className="ae-field" style={{ minWidth: 150 }}>Type
                <select className={`ae-input${newKind ? '' : ' ae-pulse'}`} value={newKind} onChange={event => setNewKind(event.target.value as 'course' | 'exam')} required data-testid="select-new-kind">
                  <option value="" disabled>Course or exam?</option>
                  <option value="course">Course</option>
                  <option value="exam">Certification Exam</option>
                </select>
              </label>
              <label className="ae-field" style={{ flex: 1, minWidth: 180 }}>{newKind === 'exam' ? 'Add an exam' : 'Add a course'}
                <input className="ae-input" value={newCourse} onChange={event => setNewCourse(event.target.value)} placeholder={newKind === 'exam' ? 'e.g. AWS Solutions Architect Associate' : newKind === 'course' ? 'Course name' : 'Pick the type first'} disabled={!newKind} maxLength={120} required data-testid="input-new-course" />
              </label>
              {newKind === 'exam' && <label className="ae-field" style={{ minWidth: 150 }}>Exam date
                <input className="ae-input" type="date" value={newExamDate} onChange={event => setNewExamDate(event.target.value)} data-testid="input-new-exam-date" />
              </label>}
              <button type="submit" className="ae-button ae-button--outline" disabled={busy || !newCourse.trim() || !newKind} data-testid="button-add-course"><Plus size={16} /> {newKind === 'exam' ? 'Add exam' : newKind === 'course' ? 'Add course' : 'Add'}</button>
            </form>}
          </div>

          {sessionStarted && materialsCheck !== 'complete' && <div className="ae-card" data-testid="panel-materials-check">
            <span className="ae-kicker">02 / YOUR MATERIALS</span>
            <h2 className="ae-heading" style={{ marginTop: 12 }}>{materialsCheck === 'pending' ? (materials.some(file => file.status === 'ready') ? MORE_MATERIALS_CHECK_PROMPT : MATERIALS_CHECK_PROMPT) : 'Add your course materials'}</h2>
            <p className="ae-muted">Adding class material helps ground the teaching in what you actually covered. You can skip it.</p>
            {materialsCheck === 'pending' ? <div className="ae-row">
              <button type="button" className="ae-button ae-button--primary" disabled={busy} onClick={() => onMaterialsChoice('add')} data-testid="button-add-materials"><UploadCloud size={17} /> Add materials</button>
              <button type="button" className="ae-button ae-button--outline" disabled={busy} onClick={() => onMaterialsChoice('skip')} data-testid="button-skip-materials">Skip for now</button>
            </div> : <div>
              <label className="ae-file-label"><UploadCloud size={17} /> Choose files
                <input type="file" multiple accept=".pdf,.docx,.txt,.md,.pptx,.png,.jpg,.jpeg" className="ae-file-input" onChange={upload} disabled={busy} data-testid="input-session-materials" />
              </label>
              <p className="ae-muted" style={{ fontSize: '.79rem', margin: '12px 0 0' }}>PDF, DOCX, PowerPoint, plain text, or image. Scanned PDFs need separate page images for OCR. Check the extraction status before continuing. Previously saved course materials remain available if you skip adding new ones.</p>
              {materials.length > 0 && <ul className="ae-file-list" aria-label="Text extraction status" data-testid="list-material-status">
                {materials.map(file => <li key={file.id} data-status={file.status} data-testid={`status-extraction-${file.id}`}>
                  <strong>{file.filename}</strong><span>{file.detail || statusLabels[file.status]}</span>
                </li>)}
              </ul>}
              <div className="ae-row" style={{ marginTop: 17 }}>
                <button type="button" className="ae-button ae-button--primary" onClick={onContinueMaterials} disabled={busy || materials.some(file => file.status === 'extracting' || file.status === 'queued')} data-testid="button-continue-materials">Continue <ArrowRight size={16} /></button>
                <button type="button" className="ae-button ae-button--quiet" onClick={() => onMaterialsChoice('skip')} disabled={busy} data-testid="button-skip-after-add">Skip instead</button>
              </div>
            </div>}
          </div>}

          {!sessionStarted && <div className="ae-card ae-card--dark" data-testid="panel-start-session">
            <span className="ae-kicker">WHEN YOU’RE READY</span>
            <h2 className="ae-heading" style={{ marginTop: 12 }}>A real conversation starts here.</h2>
            <p className="ae-muted">We’ll check for class materials once, teach the idea first, and only then move to practice.</p>
            <button type="button" className="ae-button ae-button--primary" onClick={() => selected && onStartSession(selected.id)} disabled={!canStart} data-testid="button-start-session">Start study session <ArrowRight size={16} /></button>
            {!aiConsent && <p className="ae-muted" style={{ fontSize: '.78rem', margin: '12px 0 0' }}>Review the AI notice and opt in to start.</p>}
          </div>}
          {sessionStarted && materialsCheck === 'complete' && <div className="ae-card" aria-live="polite" data-testid="status-preparing-session"><span className="ae-kicker">PREPARING YOUR SESSION</span><div className="ae-skeleton" /><div className="ae-skeleton" /><div className="ae-skeleton" /></div>}
        </>}

        {phase === 'conversation' && <div className="ae-card" data-testid="panel-conversation">
          <div className="ae-card-top"><div><span className="ae-kicker">TEACH FIRST / ASK ANYTHING</span><h2 className="ae-heading" style={{ marginTop: 11 }}>The conversation</h2><p className="ae-muted" style={{ margin: 0, fontSize: '.84rem' }}>Work through the explanation before trying to recall it.</p></div><BookOpen size={25} strokeWidth={1.5} aria-hidden="true" /></div>
          {turns.length ? <div className="ae-timeline" role="log" aria-label="Saved study conversation" data-testid="list-conversation-turns">
            {turns.map(turn => <article className={`ae-turn ae-turn--${turn.role}`} key={turn.id} data-testid={`turn-${turn.id}`}>
              <span className="ae-turn-badge" aria-hidden="true">{turn.role === 'coach' ? 'SC' : 'ME'}</span>
              <div className="ae-turn-content"><span className="ae-kicker">{turn.role === 'coach' ? (turn.kind === 'teaching' ? 'COACH / EXPLAINING' : 'STUDY COACH') : 'YOU'}</span><p>{turn.text}</p>
                {!!turn.sources?.length && <div className="ae-sources" aria-label="Sources">{turn.sources.map((source, index) => <span className="ae-source" key={`${source}-${index}`} data-testid={`source-${turn.id}-${index}`}>{source}</span>)}</div>}
              </div>
            </article>)}
          </div> : <div className="ae-callout" data-testid="text-awaiting-teaching">Your coach’s first explanation will appear here. Nothing is filled in until the session responds.</div>}
          <form className="ae-compose" onSubmit={sendTurn}>
            <label className="ae-field">Ask a follow-up or explain what’s confusing
              <textarea className="ae-input ae-input--textarea" value={draft} onChange={event => setDraft(event.target.value)} placeholder="I’m stuck on…" data-testid="textarea-session-message" />
            </label>
            <div className="ae-spread">
              <span className="ae-muted" style={{ fontSize: '.76rem' }}>Your conversation stays with this session.</span>
              <button type="submit" className="ae-button ae-button--ink" disabled={busy || !draft.trim() || !aiConsent} data-testid="button-send-session-message">Send <Send size={15} /></button>
            </div>
          </form>
          <div className="ae-later-upload" data-testid="panel-conversation-materials">
            <div><strong>Add more course files</strong><p className="ae-muted" style={{ margin: '4px 0 0', fontSize: '.78rem' }}>Your conversation stays here while text is extracted.</p></div>
            <label className="ae-file-label"><UploadCloud size={17} /> Choose files
              <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.pptx" className="ae-file-input" onChange={upload} disabled={busy} data-testid="input-conversation-materials" />
            </label>
            {materials.length > 0 && <ul className="ae-file-list" aria-label="Course file text extraction status" data-testid="list-conversation-material-status">
              {materials.map(file => <li key={file.id} data-status={file.status} data-testid={`status-conversation-extraction-${file.id}`}><strong>{file.filename}</strong><span>{file.detail || statusLabels[file.status]}</span></li>)}
            </ul>}
          </div>
          <hr className="ae-divider" />
          <div className="ae-spread"><p className="ae-muted" style={{ margin: 0, fontSize: '.81rem' }}>Ready to see what you can recall?</p><button type="button" className="ae-button ae-button--primary" onClick={onReadyForQuiz} disabled={busy || !turns.some(turn => turn.role === 'coach' && turn.kind === 'teaching')} data-testid="button-ready-for-quiz">Try practice questions <ArrowRight size={16} /></button></div>
        </div>}

        {phase === 'quiz' && <div className="ae-card" data-testid="panel-session-quiz">
          <span className="ae-kicker">{isRetest ? 'FRESH RETEST' : 'RECALL PRACTICE'}</span>
          <h2 className="ae-heading" style={{ marginTop: 10 }}>{isRetest ? 'Try a new set.' : 'Now, try it yourself.'}</h2>
          {qualityNotice && <div className="ae-callout" role="note" data-testid="notice-quiz-validity">{qualityNotice}</div>}
          <p className="ae-muted" style={{ fontSize: '.78rem', margin: '10px 0' }} data-testid="text-quiz-invalid-count">
            {flaggedQuestionIds.length} learner-flagged; {invalidItemCount} invalid item{invalidItemCount === 1 ? '' : 's'} excluded. Submit any flags before grading; flags cannot be added afterward.
          </p>
          {questions.length && currentQuestion ? <>
            <div className="ae-spread"><span className="ae-question-count" data-testid="text-question-position">QUESTION {currentIndex + 1} OF {questions.length}</span><span className="ae-muted" data-testid="text-answers-progress" style={{ fontSize: '.78rem' }}>{answered} of {answerableQuestions.length} answerable answered</span></div>
            <div className="ae-progress" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answered}><span style={{ transform: `scaleX(${answered / questions.length})` }} /></div>
            <h3 className="ae-prompt" data-testid={`text-question-${currentQuestion.id}`}>{currentQuestion.prompt}</h3>
            {currentQuestion.source && <p className="ae-source" style={{ display: 'inline-block', margin: '-9px 0 18px' }} data-testid={`text-question-source-${currentQuestion.id}`}>Source: {currentQuestion.source}</p>}
            {currentQuestion.flag ? <div className="ae-callout" role="status" data-testid={`status-question-flag-${currentQuestion.id}`}>
              <strong>Flag submitted: {currentQuestion.flag.kind === 'invalid' ? 'Invalid question' : 'Ambiguous question'}</strong>
              {currentQuestion.flag.reason && <p>{currentQuestion.flag.reason}</p>}
              <p>This question is excluded from answering and grading.</p>
            </div> : <div className="ae-quiz-help" data-testid={`panel-flag-question-${currentQuestion.id}`}>
              <span className="ae-kicker">QUESTION QUALITY</span>
              <p className="ae-muted" style={{ margin: '5px 0 10px', fontSize: '.8rem' }}>If this item is invalid or ambiguous, report it before grading. A submitted flag excludes it from your answer and score.</p>
              <div className="ae-row">
                <label className="ae-muted"><input type="radio" name={`flag-kind-${currentQuestion.id}`} checked={flagKind === 'invalid'} onChange={() => setFlagKind('invalid')} disabled={busy} /> Invalid</label>
                <label className="ae-muted"><input type="radio" name={`flag-kind-${currentQuestion.id}`} checked={flagKind === 'ambiguous'} onChange={() => setFlagKind('ambiguous')} disabled={busy} /> Ambiguous</label>
              </div>
              <label className="ae-field" htmlFor={`flag-reason-${currentQuestion.id}`}>Optional reason
                <textarea id={`flag-reason-${currentQuestion.id}`} className="ae-input ae-input--textarea" maxLength={500} value={flagReasons[currentQuestion.id] ?? ''} onChange={event => setFlagReasons(previous => ({ ...previous, [currentQuestion.id]: event.target.value }))} placeholder="What seems unclear or incorrect?" disabled={busy} data-testid={`textarea-flag-reason-${currentQuestion.id}`} />
              </label>
              <button type="button" className="ae-button ae-button--outline" onClick={() => onFlagQuestion?.(currentQuestion.id, flagKind, flagReasons[currentQuestion.id] ?? '')} disabled={busy || !onFlagQuestion} data-testid={`button-submit-flag-${currentQuestion.id}`}>Submit flag before grading</button>
            </div>}
            <div className="ae-option-list" role="radiogroup" aria-label={`Answer question ${currentIndex + 1}`}>
              {currentQuestion.options.map((option, index) => <button type="button" role="radio" aria-checked={answers[currentQuestion.id] === index} className={`ae-option ${answers[currentQuestion.id] === index ? 'is-selected' : ''}`} key={`${currentQuestion.id}-${index}`} onClick={() => onSelectAnswer(currentQuestion.id, index)} disabled={busy || !!currentQuestion.flag} data-testid={`button-answer-${currentQuestion.id}-${index}`}><span className="ae-option-letter">{String.fromCharCode(65 + index)}</span>{option}</button>)}
            </div>
            <div className="ae-quiz-help" data-testid="panel-quiz-tutoring">
              <span className="ae-kicker">NEED TO TALK IT THROUGH?</span>
              <form className="ae-compose" onSubmit={askDuringQuiz}>
                <label className="ae-field" htmlFor="ae-quiz-help-input">Ask your coach about this question
                  <textarea id="ae-quiz-help-input" className="ae-input ae-input--textarea" value={quizDraft} onChange={event => setQuizDraft(event.target.value)} placeholder="What am I missing here?" data-testid="textarea-quiz-help" />
                </label>
                <button type="submit" className="ae-button ae-button--ink" disabled={busy || !aiConsent || !quizDraft.trim() || !onAskDuringQuiz} data-testid="button-ask-during-quiz">Ask coach <Send size={15} /></button>
              </form>
              {quizTutorReply?.role === 'coach' && <div className="ae-turn ae-quiz-reply" aria-live="polite" data-testid="reply-quiz-tutor">
                <span className="ae-turn-badge" aria-hidden="true">SC</span>
                <div className="ae-turn-content"><span className="ae-kicker">COACH / LATEST REPLY</span><p>{quizTutorReply.text}</p>
                  {!!quizTutorReply.sources?.length && <div className="ae-sources" aria-label="Reply sources">{quizTutorReply.sources.map((source, index) => <span className="ae-source" key={`${source}-${index}`} data-testid={`source-quiz-reply-${index}`}>{source}</span>)}</div>}
                </div>
              </div>}
              <label className="ae-assisted-label">
                <input type="checkbox" checked={!!assistedAnswers?.[currentQuestion.id]} onChange={event => onMarkAssisted?.(currentQuestion.id, event.target.checked)} disabled={busy || !onMarkAssisted} data-testid={`checkbox-assisted-${currentQuestion.id}`} />
                Mark this question as assisted
              </label>
              <p className="ae-muted" style={{ fontSize: '.76rem', margin: '8px 0 0' }}>This marks your study record only. Grading is handled separately when results come back.</p>
            </div>
            <div className="ae-answer-dots" aria-label="Jump to question">{questions.map((question, index) => <button type="button" key={question.id} className={`${answers[question.id] !== undefined ? 'is-answered' : ''} ${index === currentIndex ? 'is-current' : ''}`} onClick={() => setQuestionIndex(index)} aria-label={`Question ${index + 1}${answers[question.id] !== undefined ? ', answered' : ', unanswered'}`} aria-current={index === currentIndex ? 'step' : undefined} data-testid={`button-jump-question-${question.id}`}>{index + 1}</button>)}</div>
            <div className="ae-question-nav">
              <button type="button" className="ae-button ae-button--outline" onClick={() => setQuestionIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} data-testid="button-previous-question"><ArrowLeft size={15} /> Previous</button>
              {currentIndex < questions.length - 1 ? <button type="button" className="ae-button ae-button--ink" onClick={() => setQuestionIndex(currentIndex + 1)} data-testid="button-next-question">Next <ArrowRight size={15} /></button> : <button type="button" className="ae-button ae-button--primary" onClick={onSubmitQuiz} disabled={!canSubmit} data-testid="button-submit-session-quiz">Check my answers <ArrowRight size={15} /></button>}
            </div>
            {currentIndex < questions.length - 1 && canSubmit && <button type="button" className="ae-button ae-button--quiet" onClick={onSubmitQuiz} style={{ marginTop: 8 }} data-testid="button-submit-answered-quiz">All answered — check my work</button>}
            <p className="ae-muted" style={{ fontSize: '.76rem', margin: '17px 0 0' }}>Answers can be changed until you submit. No result is shown early.</p>
          </> : <div aria-live="polite" data-testid="status-loading-questions"><div className="ae-skeleton" /><div className="ae-skeleton" /><div className="ae-skeleton" /></div>}
        </div>}

        {phase === 'grading' && <div className="ae-card" aria-live="polite" data-testid="status-grading"><span className="ae-kicker">CHECKING YOUR WORK</span><h2 className="ae-heading" style={{ marginTop: 11 }}>Making sense of each answer.</h2><p className="ae-muted">We’ll show what held, what needs another explanation, and what to revisit.</p><div className="ae-skeleton" /><div className="ae-skeleton" /><div className="ae-skeleton" /></div>}

        {phase === 'review' && <div className="ae-card" data-testid="panel-session-review">
          <span className="ae-kicker">FEEDBACK / TEACH AGAIN</span><h2 className="ae-heading" style={{ marginTop: 11 }}>Let’s close the gaps.</h2>
          {resultSummary && <p className="ae-muted" data-testid="text-result-summary">{resultSummary}</p>}
          <div className="ae-callout" role="note" data-testid="notice-postgrade-flags">Question flags must be submitted before grading. No post-grade flag submission or change is available.</div>
          {feedback.length ? feedback.map(item => <article className="ae-grade-row" key={item.questionId} data-testid={`feedback-${item.questionId}`}>
            <div className="ae-spread"><strong>{questions.find(q => q.id === item.questionId)?.prompt || 'Review this answer'}</strong><span className="ae-grade-tag" data-result={item.result}>{item.result === 'partial' ? 'Partly there' : item.result === 'correct' ? 'Correct' : 'Needs another pass'}</span></div>
            <p>{item.explanation}</p>{item.answerNote && <p className="ae-muted">{item.answerNote}</p>}
            {item.teaching && <div className="ae-callout ae-callout--green"><strong>Think about it this way</strong><p>{item.teaching}</p></div>}
          </article>) : <p className="ae-muted" data-testid="text-no-feedback">Feedback will appear when grading is complete.</p>}
          <div className="ae-row" style={{ marginTop: 20 }}>
            {!isRetest && <button type="button" className="ae-button ae-button--primary" onClick={onRequestRetest} disabled={busy || !feedback.length} data-testid="button-fresh-retest">Try a fresh retest <ArrowRight size={16} /></button>}
          </div>
        </div>}

      </div>

      <aside className="ae-aside" aria-label="Session context">
        <div className="ae-card ae-card--compact ae-card--tint" data-testid="panel-ai-consent">
          <ShieldCheck size={23} strokeWidth={1.6} aria-hidden="true" style={{ color: '#407058', marginBottom: 11 }} />
          <h2 className="ae-heading" style={{ fontSize: '1.35rem' }}>Before AI joins in</h2>
          {/* Same three lines as the phone's consent card (D-082), naming the providers. */}
          <ul className="ae-muted" style={{ fontSize: '.8rem', margin: '0 0 14px', paddingLeft: 18, lineHeight: 1.5 }}>
            <li>Your messages, course names, chosen course material and quiz answers go to Anthropic Claude to coach you. Lecture recordings are transcribed by OpenAI.</li>
            <li>AI can make mistakes. Report a reply that looks wrong.</li>
            <li>You can change this choice at any time.</li>
          </ul>
          <label className="ae-row" style={{ alignItems: 'flex-start', fontSize: '.81rem', fontWeight: 700, cursor: 'pointer' }}>
            <input type="checkbox" checked={aiConsent} onChange={event => onConsentChange(event.target.checked)} disabled={busy} data-testid="checkbox-ai-consent" style={{ marginTop: 3, accentColor: '#bd5a3b' }} />
            I understand and agree to AI processing for my account until I turn it off.
          </label>
        </div>
        <div className="ae-card ae-card--compact" data-testid="panel-review-schedule">
          <span className="ae-kicker">NEXT PASSES</span><h2 className="ae-heading" style={{ fontSize: '1.35rem', marginTop: 10 }}>Review schedule</h2>
          {reviewSchedule.length ? <ul className="ae-schedule">{reviewSchedule.map(item => <li key={item.id} data-testid={`review-item-${item.id}`}><div><strong>{item.concept}</strong>{item.note && <div className="ae-muted" style={{ marginTop: 4 }}>{item.note}</div>}</div><span>{item.dueLabel || 'Not scheduled'}</span></li>)}</ul> : <p className="ae-muted" style={{ fontSize: '.81rem' }} data-testid="text-no-review-schedule">No review items yet. After practice, concepts that need another pass can appear here.</p>}
        </div>
        <div className="ae-card ae-card--compact" data-testid="panel-session-context">
          <FileText size={21} strokeWidth={1.6} aria-hidden="true" style={{ color: '#b9583c', marginBottom: 11 }} />
          <span className="ae-kicker" style={{ display: 'block' }}>CURRENT COURSE</span>
          <strong style={{ display: 'block', margin: '8px 0 5px' }} data-testid="text-selected-course">{selected?.name ?? 'Choose a course'}</strong>
          <p className="ae-muted" style={{ fontSize: '.78rem', margin: 0 }}>{materials.filter(file => file.status === 'ready').length} material{materials.filter(file => file.status === 'ready').length === 1 ? '' : 's'} with text ready</p>
        </div>
      </aside>
    </div>
  </section>;
}

export default AccountExperience;
/** Type or correct the real exam's question count, time limit and passing score (spec B, D-111). */
function ExamFactsForm({ courseId, facts, busy, onSave }: { courseId: string; facts?: ExamFacts; busy: boolean; onSave: (facts: ExamFacts) => void }) {
  const [questions, setQuestions] = useState(facts?.questionCount ? String(facts.questionCount) : '');
  const [minutes, setMinutes] = useState(facts?.durationMinutes ? String(facts.durationMinutes) : '');
  const [passing, setPassing] = useState(facts?.passingScore ?? '');
  const [problem, setProblem] = useState('');
  const missing = !facts?.questionCount || !facts?.durationMinutes;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const read = factsFromInputs(questions, minutes, passing);
    if ('error' in read) { setProblem(read.error); return; }
    setProblem('');
    onSave(read.facts);
  };
  return (
    <form onSubmit={submit} style={{ marginTop: 8 }} data-testid={`form-exam-facts-${courseId}`}>
      <p className="ae-muted" style={{ fontSize: '.85rem' }}>{missing ? 'Real exam: type the number of questions and the time limit from the official page (used to time full simulations).' : 'Real exam (correct it if the official page says otherwise):'}</p>
      <div className="ae-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="ae-input" inputMode="numeric" placeholder="Questions" aria-label="Number of questions on the real exam" value={questions} onChange={event => setQuestions(event.target.value)} maxLength={3} style={{ width: 110 }} data-testid={`input-exam-questions-${courseId}`} />
        <input className="ae-input" inputMode="numeric" placeholder="Minutes" aria-label="Time limit of the real exam in minutes" value={minutes} onChange={event => setMinutes(event.target.value)} maxLength={3} style={{ width: 110 }} data-testid={`input-exam-minutes-${courseId}`} />
        <input className="ae-input" placeholder="Passing score, e.g. 700 out of 1000" aria-label="Passing score of the real exam" value={passing} onChange={event => setPassing(event.target.value)} maxLength={60} style={{ flex: 1, minWidth: 180 }} data-testid={`input-exam-passing-${courseId}`} />
        <button type="submit" className="ae-button" disabled={busy} data-testid={`button-save-exam-facts-${courseId}`}>Save</button>
      </div>
      {problem && <p className="ae-muted" role="alert">{problem}</p>}
    </form>
  );
}
