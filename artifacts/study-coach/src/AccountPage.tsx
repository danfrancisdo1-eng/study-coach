import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetStudyState, usePutStudyState, useImportStudyState, useListStudySessions,
  useCreateStudySession, useGetStudySession, useCheckInStudySession,
  useSendStudyMessage, useGenerateStudyQuiz, useSaveStudyAnswer, useGradeStudyQuiz,
  useFlagStudyQuestion, useLookupExamGuide,
  getGetStudyStateQueryKey, getGetStudySessionQueryKey, getListStudySessionsQueryKey,
  deleteCourse, getListLecturesQueryKey,
  type StudyMaterialExtraction, type StudySession, type StudyState, type StudyStateEnvelope,
} from '@workspace/api-client-react';
import AccountExperience, {
  type AccountCourse, type MaterialExtraction, type QuestionFeedback,
  type ReviewItem, type SessionTurn,
} from './AccountExperience';
import MaterialIntake from './MaterialIntake';
import HomeChat from './HomeChat';
import { readLegacyStudyData } from './lib/legacy-import';

type AccountState = {
  aiConsent: boolean;
  courses?: AccountCourse[];
  materials?: Array<{ id: string; courseId: string; name: string; text: string; addedAt: string }>;
  checkInChoices?: Record<string, 'adding'>;
  reviewSchedule?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
const stateKey = getGetStudyStateQueryKey();
const listKey = getListStudySessionsQueryKey();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const asState = (state: StudyState | null): AccountState =>
  (state ?? { aiConsent: false }) as AccountState;
const formatDate = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

type SheetRow = { id: string; term: string; trick: string; whenYouSee: string; think: string };
/** Groups state.memorySheet rows by course, keeping only well-formed rows (D-025). */
function memorySheetsByCourse(sheet: unknown): Record<string, SheetRow[]> {
  const out: Record<string, SheetRow[]> = {};
  if (!Array.isArray(sheet)) return out;
  for (const item of sheet) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.courseId !== 'string' || typeof r.id !== 'string' || typeof r.term !== 'string') continue;
    (out[r.courseId] ??= []).push({ id: r.id, term: r.term, trick: typeof r.trick === 'string' ? r.trick : '', whenYouSee: typeof r.whenYouSee === 'string' ? r.whenYouSee : '', think: typeof r.think === 'string' ? r.think : '' });
  }
  return out;
}

export function AccountPage({ onClassic, onSignOut }: { onClassic: () => void; onSignOut: () => void }) {
  const client = useQueryClient();
  const stateQuery = useGetStudyState();
  const sessionsQuery = useListStudySessions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionQuery = useGetStudySession(sessionId ?? '', { query: {
    enabled: !!sessionId, queryKey: getGetStudySessionQueryKey(sessionId ?? ''),
  } });
  const put = usePutStudyState();
  const importer = useImportStudyState();
  const create = useCreateStudySession();
  const checkIn = useCheckInStudySession();
  const send = useSendStudyMessage();
  const quiz = useGenerateStudyQuiz();
  const answer = useSaveStudyAnswer();
  const grade = useGradeStudyQuiz();
  const flagQuestion = useFlagStudyQuestion();
  const lookupGuide = useLookupExamGuide();
  const [selectedCourseId, selectCourse] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [minutes, setMinutes] = useState(35);
  const [adding, setAdding] = useState(false);
  const [uploadStatuses, setUploadStatuses] = useState<MaterialExtraction[]>([]);
  const [intakeFiles, setIntakeFiles] = useState<File[]>([]);
  const [intakeCourseId, setIntakeCourseId] = useState<string | null>(null); // course for material added from the home chat
  const [assistedDrafts, setAssistedDrafts] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const envelope = stateQuery.data;
  const state = asState(envelope?.state ?? null);
  const current = sessionQuery.data;
  const courses = (state.courses ?? []).filter((course): course is AccountCourse =>
    !!course && typeof course.id === 'string' && typeof course.name === 'string');
  const courseId = current?.courseId ?? selectedCourseId;
  const materials = state.materials?.filter(item => item.courseId === courseId).map(item => ({
    id: item.id, filename: item.name, status: 'ready' as const,
    detail: 'Saved to this course',
  })) ?? [];
  const savedMaterialsByCourse: Record<string, { id: string; name: string }[]> = {};
  for (const item of state.materials ?? []) {
    if (item && typeof item.courseId === 'string' && typeof item.id === 'string') {
      (savedMaterialsByCourse[item.courseId] ??= []).push({ id: item.id, name: item.name });
    }
  }
  const busy = put.isPending || importer.isPending || create.isPending || checkIn.isPending ||
    send.isPending || quiz.isPending || answer.isPending || grade.isPending || flagQuestion.isPending;

  const replaceState = async (next: AccountState) => {
    if (!envelope) throw new Error('Account state is still loading.');
    const result = await put.mutateAsync({ data: { state: next, version: envelope.version } });
    client.setQueryData<StudyStateEnvelope>(stateKey, result);
    return result;
  };
  const updateState = async (updater: (previous: AccountState) => AccountState) => {
    await replaceState(updater(state));
  };
  // Shared by the in-session intake and the home-chat intake (same rules, one place).
  const saveMaterial = async (targetCourseId: string, preview: StudyMaterialExtraction) => {
    if (!preview.text.trim() || preview.text.length > 100000) throw new Error('Material must contain 1–100,000 characters.');
    try {
      await updateState(previous => ({ ...previous, materials: [...(previous.materials ?? []), {
        id: crypto.randomUUID(), courseId: targetCourseId, name: preview.filename, text: preview.text.trim(), addedAt: new Date().toISOString(),
        sourceUrl: preview.sourceUrl, extractionFormat: preview.format, extractionCoverage: preview.coverage, coverageNote: preview.coverageNote,
      }] }));
    } catch (problem) {
      if (message(problem).includes('409')) await stateQuery.refetch();
      throw problem;
    }
  };
  const applySession = (result: StudySession) => {
    client.setQueryData(getGetStudySessionQueryKey(result.id), result);
    void client.invalidateQueries({ queryKey: listKey });
  };
  const act = async (operation: () => Promise<void>) => {
    setError('');
    try { await operation(); }
    catch (cause) {
      setError(message(cause));
      if (message(cause).includes('409')) {
        await client.invalidateQueries({ queryKey: stateKey });
        await client.invalidateQueries({ queryKey: sessionId ? getGetStudySessionQueryKey(sessionId) : listKey });
      }
    }
  };
  const teach = async (id: string, title: string) => {
    const result = await send.mutateAsync({ id, data: {
      content: `Please teach me ${title} first. Explain the core idea, distinguish what is directly supported by my uploaded material from supplemental knowledge or inferred coverage, and ask one useful follow-up question before I take a quiz.`,
    } });
    applySession(result);
  };

  const turns: SessionTurn[] = current?.messages.map((item, index) => ({
    id: `${current.id}-${index}`,
    role: item.role === 'assistant' ? 'coach' : 'student',
    kind: item.role === 'assistant' && index === 1 ? 'teaching' : 'message',
    text: item.content,
    sources: item.sourceStatus
      ? [
        `Coverage: ${item.sourceStatus.coverage} (${item.sourceStatus.selectedChunks} of ${item.sourceStatus.availableChunks} chunks${item.sourceStatus.truncated ? '; selected, not complete' : ''})`,
        ...item.sourceStatus.sources.map(source => `${source.kind}: ${source.label}`),
      ]
      : undefined,
  })) ?? [];
  const questions = current?.quiz?.questions.map(item => ({
    id: item.id, prompt: item.prompt, options: item.options.map(option => option.text),
    flag: item.flag,
    source: current.quiz?.sourceStatus.sources.filter(source => source.kind === 'source').map(source => source.label).join(', ') || undefined,
  })) ?? [];
  const flaggedQuestionIds = (current?.quiz?.questions ?? []).filter(item => item.flag).map(item => item.id);
  const answers = Object.fromEntries((current?.quiz?.questions ?? []).flatMap(item => {
    const selected = item.options.findIndex(option => option.id === item.answer?.optionId);
    return selected < 0 ? [] : [[item.id, selected]];
  }));
  const assistedAnswers = Object.fromEntries((current?.quiz?.questions ?? []).map(item => [
    item.id, item.answer?.assisted ?? assistedDrafts[item.id] ?? false,
  ]));
  const lastQuizReplyIndex = current?.messages.findLastIndex((item, index, messages) =>
    item.role === 'assistant' && index > 0 && messages[index - 1]?.role === 'user' &&
    messages[index - 1]?.content.startsWith('Help with practice question ')) ?? -1;
  const quizTutorReply = lastQuizReplyIndex >= 0 ? turns[lastQuizReplyIndex] : null;
  const feedback: QuestionFeedback[] = (current?.quiz?.questions ?? []).flatMap(item => {
    const detail = item.feedback;
    return detail ? [{
      questionId: item.id, result: detail.selectedOptionId === detail.correctOptionId ? 'correct' : 'incorrect',
      explanation: detail.explanation,
      teaching: detail.selectedOptionId === detail.correctOptionId ? undefined : `Compare the selected answer with: ${detail.correctOptionText}.`,
      answerNote: `Your answer: ${detail.selectedOptionText ?? 'not answered'}. Correct: ${detail.correctOptionText}.${detail.assisted ? ' Answer marked assisted.' : ''}`,
    }] : [];
  });
  const reviewSchedule: ReviewItem[] = (current?.reviewSchedule ?? state.reviewSchedule ?? []).map((item, index) => ({
    id: `${index}`, concept: String(item.concept ?? 'Concept'), dueLabel: formatDate(item.dueAt),
    note: item.result === 'missed' ? 'Try recall again' : 'Keep practicing',
  }));
  const phase = !current || !current.checkIn ? 'setup' :
    current.quiz?.grade ? 'review' :
    current.quiz ? 'quiz' :
    current.messages.length ? 'conversation' : 'setup';
  const resultSummary = current?.quiz?.grade
    ? `${current.quiz.grade.correct} correct of ${current.quiz.grade.answered} answered; ${current.quiz.grade.excluded} excluded, including ${current.quiz.grade.invalidItems} invalid items. ${current.quiz.grade.percent}% of answered valid questions.`
    : undefined;

  if (stateQuery.isLoading || sessionsQuery.isLoading) return <div className="onboard"><p className="notice">Opening your private study space…</p></div>;
  if (stateQuery.error || sessionsQuery.error) return <div className="onboard"><div className="error" role="alert">{message(stateQuery.error ?? sessionsQuery.error)}</div><button type="button" className="btn btn-outline" onClick={() => { void stateQuery.refetch(); void sessionsQuery.refetch(); }} data-testid="button-retry-account">Try again</button></div>;

  return <div className="onboard" style={{ maxWidth: 1190 }}>
    <div className="spread" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
      <strong className="brand" style={{ color: '#293448' }}>study coach<span style={{ color: '#d36748' }}>.</span></strong>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-quiet" onClick={onClassic} data-testid="button-classic-workspace">Lecture desk · browser-only</button>
        <button type="button" className="btn btn-outline" onClick={onSignOut} data-testid="button-sign-out">Sign out</button>
      </div>
    </div>
    <div className="notice" style={{ marginBottom: 18 }}>Want to record or import a lecture? Open the browser-only lecture desk above. Its audio, corrected transcripts, and source-linked practice questions are separate from this account’s courses and materials; they do not sync between devices.</div>
    {sessionsQuery.data?.sessions.length ? <label className="field" style={{ maxWidth: 500, marginBottom: 16 }}>Your saved sessions
      <select value={sessionId ?? ''} onChange={event => { setIntakeFiles([]); setSessionId(event.target.value || null); setAdding(false); }} data-testid="select-saved-session">
        <option value="">Start a new session</option>
        {sessionsQuery.data.sessions.map(item => <option key={item.id} value={item.id}>{item.topic} · {courses.find(course => course.id === item.courseId)?.name ?? 'Course'} · {formatDate(item.createdAt)}</option>)}
      </select>
    </label> : null}
    {sessionId && sessionQuery.isLoading ? <div className="notice">Restoring your saved session…</div> : sessionId && sessionQuery.error ? <div className="error" role="alert">{message(sessionQuery.error)} <button type="button" onClick={() => void sessionQuery.refetch()} data-testid="button-retry-load-session">Try again</button></div> : <>
      {!current && <HomeChat aiConsent={state.aiConsent === true} busy={busy} courseId={selectedCourseId}
        onCoursesChanged={() => void client.invalidateQueries({ queryKey: stateKey })}
        onOpenSession={id => { setIntakeFiles([]); setSessionId(id); setAdding(false); void client.invalidateQueries({ queryKey: listKey }); }} />}
      {!current && courses.length > 0 && (
        <section className="ae-card" data-testid="panel-home-intake" style={{ marginBottom: 17 }}>
          <div className="ae-card-top"><div><span className="ae-kicker">ADD MATERIAL</span><h2 className="ae-heading">Which course?</h2></div></div>
          <select className="ae-input" aria-label="Course for new material" value={intakeCourseId ?? courses[0]!.id} onChange={event => { setIntakeFiles([]); setIntakeCourseId(event.target.value); }} data-testid="select-intake-course" style={{ maxWidth: 360, marginBottom: 12 }}>
            {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select>
          <MaterialIntake key={intakeCourseId ?? courses[0]!.id} courseName={courses.find(item => item.id === (intakeCourseId ?? courses[0]!.id))?.name ?? 'this course'}
            consent={state.aiConsent} files={intakeFiles} onFilesChange={setIntakeFiles}
            onSave={preview => saveMaterial(intakeCourseId ?? courses[0]!.id, preview)} />
        </section>
      )}
      {!current && <div className="grid2" style={{ marginBottom: 17 }}>
        <label className="field">Focus topic for this session<input value={topic} maxLength={300} onChange={event => setTopic(event.target.value)} placeholder="e.g. Photosynthesis or today's lecture" data-testid="input-session-topic" /></label>
        <label className="field">Minutes available<input type="number" value={minutes} min={1} max={360} onChange={event => setMinutes(Number(event.target.value))} data-testid="input-session-minutes" /></label>
      </div>}
      {current?.checkIn && !current.messages.length && !current.quiz && <div className="notice" style={{ marginBottom: 18 }}>Your materials choice is saved. <button type="button" className="btn btn-dark" onClick={() => void act(() => teach(current.id, current.topic))} disabled={busy} data-testid="button-begin-teaching">Begin teaching</button></div>}
      {!current && !courses.length && !state.materials?.length && !sessionsQuery.data?.sessions.length && <LegacyImport onImport={async saved => {
        if (envelope?.state == null) {
          const imported = await importer.mutateAsync({ data: { state: saved } });
          client.setQueryData(stateKey, imported);
        } else {
          await replaceState(saved as AccountState);
        }
      }} />}
      <AccountExperience
        courses={courses} selectedCourseId={courseId ?? null} phase={phase}
        sessionStarted={!!current} materialsCheck={current?.checkIn ? 'complete' : adding || (current && state.checkInChoices?.[current.id] === 'adding') ? 'adding' : 'pending'}
        aiConsent={state.aiConsent} materials={[...materials, ...uploadStatuses]}
        turns={turns} questions={questions} answers={answers} assistedAnswers={assistedAnswers}
        qualityNotice={current?.quiz?.qualityNotice} invalidItemCount={current?.quiz?.invalidItemCount ?? 0}
        flaggedQuestionIds={flaggedQuestionIds}
        quizTutorReply={quizTutorReply} feedback={feedback}
        reviewSchedule={reviewSchedule}
        resultSummary={resultSummary} isRetest={current?.quiz?.mode === 'targeted'}
        busy={busy} error={error}
        onSelectCourse={selectCourse}
        onCreateCourse={(name, kind, examDate) => void act(async () => {
          const id = crypto.randomUUID();
          await updateState(previous => ({ ...previous, courses: [...(previous.courses ?? []), { id, name, kind, ...(examDate ? { examDate } : {}) }] }));
          selectCourse(id);
          if (kind === 'exam') { try { await lookupGuide.mutateAsync({ courseId: id }); } catch { /* shown as "no guide" */ } await stateQuery.refetch(); }
        })}
        savedMaterialsByCourse={savedMaterialsByCourse}
        examGuides={Object.fromEntries((state.courses ?? []).filter((c): c is AccountCourse & { examGuide?: unknown } => !!c && typeof (c as { id?: unknown }).id === 'string').map(c => [c.id, (c as { examGuide?: { found?: boolean; sections?: { name: string; weight: number | null }[]; sourceUrl?: string | null } }).examGuide ?? null]))}
        onRefreshExamGuide={courseId => void act(async () => { await lookupGuide.mutateAsync({ courseId }); await stateQuery.refetch(); })}
        memorySheets={memorySheetsByCourse((state as { memorySheet?: unknown }).memorySheet)}
        onDeleteMaterial={materialId => void act(() => updateState(previous => ({
          ...previous, materials: (previous.materials ?? []).filter(item => item.id !== materialId),
        })))}
        onDeleteCourse={id => void act(async () => {
          const result = await deleteCourse(id);
          client.setQueryData<StudyStateEnvelope>(stateKey, { state: result.state, version: result.version });
          await client.invalidateQueries({ queryKey: listKey });
          await client.invalidateQueries({ queryKey: getListLecturesQueryKey() });
          if (selectedCourseId === id) selectCourse(null);
          setNotice(`Deleted the course with ${result.deleted.materials} materials, ${result.deleted.sessions} sessions and ${result.deleted.lectures} lectures.`);
        })}
        onRenameCourse={(id, name) => void act(() => updateState(previous => ({
          ...previous, courses: (previous.courses ?? []).map(course => course.id === id ? { ...course, name } : course),
        })))}
        onStartSession={id => void act(async () => {
          if (!topic.trim()) throw new Error('Enter a focus topic before starting.');
          if (!Number.isInteger(minutes) || minutes < 1 || minutes > 360) throw new Error('Choose 1–360 minutes.');
          const result = await create.mutateAsync({ data: { courseId: id, topic: topic.trim(), minutes } });
          client.setQueryData(getGetStudySessionQueryKey(result.id), result);
          setIntakeFiles([]);
          setSessionId(result.id);
          void client.invalidateQueries({ queryKey: listKey });
        })}
        onMaterialsChoice={choice => void act(async () => {
          if (!current) return;
          if (choice === 'add') {
            await updateState(previous => ({ ...previous, checkInChoices: { ...previous.checkInChoices, [current.id]: 'adding' } }));
            setAdding(true);
            return;
          }
          const result = await checkIn.mutateAsync({ id: current.id, data: { skipped: true } });
          applySession(result);
          setAdding(false);
          await teach(current.id, current.topic);
        })}
        onUploadMaterials={files => setIntakeFiles(files)}
        onContinueMaterials={() => void act(async () => {
          if (!current) return;
          const result = await checkIn.mutateAsync({ id: current.id, data: { skipped: false } });
          applySession(result);
          setAdding(false);
          setUploadStatuses([]);
          await teach(current.id, current.topic);
        })}
        onConsentChange={consented => void act(() => updateState(previous => ({ ...previous, aiConsent: consented })))}
        onSendTurn={text => void act(async () => {
          if (!current) return;
          applySession(await send.mutateAsync({ id: current.id, data: { content: text } }));
        })}
        onReadyForQuiz={() => void act(async () => {
          if (!current) return;
          applySession(await quiz.mutateAsync({ id: current.id, data: { mode: 'diagnostic' } }));
        })}
        onSelectAnswer={(questionId, optionIndex) => void act(async () => {
          if (!current?.quiz) return;
          if (current.quiz.questions.find(item => item.id === questionId)?.flag) throw new Error('This question is flagged and cannot be answered.');
          const optionId = current.quiz.questions.find(item => item.id === questionId)?.options[optionIndex]?.id;
          if (!optionId) throw new Error('Option unavailable; reopen this session.');
          applySession(await answer.mutateAsync({ id: current.id, data: { questionId, optionId, assisted: assistedAnswers[questionId] ?? false } }));
        })}
        onFlagQuestion={(questionId, kind, reason) => void act(async () => {
          if (!current?.quiz || current.quiz.grade) throw new Error('Questions can only be flagged before grading.');
          const result = await flagQuestion.mutateAsync({
            id: current.id, questionId,
            data: { kind, ...(reason.trim() ? { reason: reason.trim() } : {}) },
          });
          applySession(result);
        })}
        onAskDuringQuiz={(questionId, text) => void act(async () => {
          if (!current) return;
          const question = current.quiz?.questions.find(item => item.id === questionId);
          if (!question) throw new Error('This practice question is no longer available.');
          const updated = await send.mutateAsync({ id: current.id, data: {
            content: `Help with practice question ${questionId}: ${question.prompt}\nMy question: ${text}\nPlease guide my thinking without revealing the correct option.`,
          } });
          applySession(updated);
          setAssistedDrafts(previous => ({ ...previous, [questionId]: true }));
          if (question.answer) {
            applySession(await answer.mutateAsync({ id: current.id, data: {
              questionId, optionId: question.answer.optionId, assisted: true,
            } }));
          }
        })}
        onMarkAssisted={(questionId, assisted) => void act(async () => {
          if (!current?.quiz) return;
          const selected = current.quiz.questions.find(item => item.id === questionId)?.answer;
          setAssistedDrafts(previous => ({ ...previous, [questionId]: assisted }));
          if (selected) {
            applySession(await answer.mutateAsync({ id: current.id, data: {
              questionId, optionId: selected.optionId, assisted,
            } }));
          }
        })}
        onSubmitQuiz={() => void act(async () => {
          if (!current) return;
          applySession(await grade.mutateAsync({ id: current.id }));
          void client.invalidateQueries({ queryKey: stateKey });
        })}
        onRequestRetest={() => void act(async () => {
          if (!current) return;
          applySession(await quiz.mutateAsync({ id: current.id, data: { mode: 'targeted' } }));
        })}
        onRetry={() => { setError(''); void stateQuery.refetch(); if (sessionId) void sessionQuery.refetch(); }}
      />
      {current ? <MaterialIntake key={current.id} courseName={courses.find(item => item.id === current.courseId)?.name ?? 'this course'}
        consent={state.aiConsent} files={intakeFiles} onFilesChange={setIntakeFiles}
        onSave={preview => saveMaterial(current.courseId, preview)} /> : null}
      {notice && <p className="notice" role="status" data-testid="status-notice">{notice}</p>}
    </>}
  </div>;
}

function LegacyImport({ onImport }: { onImport: (state: StudyState) => Promise<void> }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof readLegacyStudyData>>>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="notice" style={{ marginBottom: 22 }}>
    <strong>Have work saved in this browser?</strong> Nothing is linked to your account automatically.
    {!preview
      ? <div style={{ marginTop: 10 }}><button type="button" className="btn btn-outline" onClick={() => void readLegacyStudyData().then(saved => {
        if (!saved) setError('No older browser workspace was found.');
        else setPreview(saved);
      }).catch(cause => setError(message(cause)))} data-testid="button-preview-legacy">Preview local workspace</button></div>
      : <div style={{ marginTop: 10 }}>
        <p>{preview.courses.length} courses, {preview.materials.length} materials, {preview.attempts.length} past quiz attempts. Confirm this is your own work before importing to your signed-in account. Dated deadlines will be held separately for your review, not treated as confirmed. The original browser data stays untouched.</p>
        <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} data-testid="checkbox-confirm-legacy" /> This browser workspace is mine and I want to link it to this account.</label>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={!checked || busy} onClick={() => void (async () => {
            setBusy(true); setError('');
            try {
              const { deadlines, ...rest } = preview;
              await onImport({ ...rest, aiConsent: false, deadlines: [], pendingDeadlines: deadlines });
            } catch (cause) { setError(message(cause)); }
            finally { setBusy(false); }
          })()} data-testid="button-confirm-import">Import into this account</button>
          <button type="button" className="btn btn-quiet" onClick={() => { setPreview(null); setChecked(false); }} data-testid="button-cancel-import">Not now</button>
        </div>
      </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}