// Simulated students (D-132). Each persona (sims/personas.mjs) uses the real app logic end to end
// against a private copy of the server on this Mac (throwaway in-memory database, locally signed
// sign-in, the real AI models), the way the phone does: it creates the course in the chat, uploads
// synthetic materials, records a lecture transcript, then talks to the coach, taking sets and decks.
// A judge reads every conversation and a report is written to sims/reports/.
//
//   node sims/run.mjs                      all 15 personas (about $10–15)
//   node sims/run.mjs --quick              3 personas (about $2–3)
//   node sims/run.mjs --personas bio,cissp
//   node sims/run.mjs --turns 12           coach turns per persona (default 14)
//
// Materials are generated once per persona (sims/materials/<id>.json, synthetic) and reused.
// Keys: artifacts/api-server/.env (ANTHROPIC_API_KEY). Nothing touches the live server or real accounts.
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer, startServer, serverDir } from '../tests/helpers/server.mjs';
import { startDatabase } from '../tests/helpers/database.mjs';
import { personas } from './personas.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(serverDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required (artifacts/api-server/.env).');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const QUICK = ['bio', 'calc2', 'cissp'];
const chosen = args.includes('--quick') ? QUICK : opt('personas')?.split(',').map((s) => s.trim()) ?? personas.map((p) => p.id);
const TURNS = Number(opt('turns') ?? 14);
const STUDENT_MODEL = process.env.SIM_STUDENT_MODEL || 'claude-sonnet-5-5';
const JUDGE_MODEL = process.env.SIM_JUDGE_MODEL || 'claude-opus-5-5';
const TODAY = new Date().toISOString().slice(0, 10);

const anthropic = new Anthropic();
const usage = { input: 0, output: 0 };
async function ask(model, system, payload, schema, effort = 'low') {
  const response = await anthropic.messages.create({
    model, max_tokens: 16000,
    output_config: { effort, format: { type: 'json_schema', schema } },
    system, messages: [{ role: 'user', content: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
  });
  usage.input += response.usage?.input_tokens ?? 0;
  usage.output += response.usage?.output_tokens ?? 0;
  return JSON.parse(response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
}
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: 'string' };

// ---------- 1. Synthetic materials (generated once, cached) ----------
async function materialsFor(p) {
  const file = path.join(dir, 'materials', `${p.id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  console.log(`  writing synthetic materials for ${p.id}…`);
  const m = await ask(STUDENT_MODEL,
    `You write SYNTHETIC study materials for testing a study app. Everything is fictional but realistic for the subject. Today is ${TODAY} (fall 2026 term). Reply as JSON.`,
    `Student: ${p.name}, ${p.age}, ${p.level}. ${p.kind === 'exam' ? `Preparing for the ${p.course} certification exam.` : `Taking ${p.course}.`}
Write:
- "syllabus": ${p.kind === 'exam' ? 'a study plan / exam outline the student made: the exam domains with weights, a planned exam date about 5 weeks from today, weekly study goals with dates, and two practice-test dates' : 'a realistic course syllabus: instructor (fictional), weekly schedule with dates for the whole term, every quiz with its date and topic (one quiz about 6 days from today), a midterm or unit test date, the final exam date, a grading breakdown with percentages, and 2–3 policies'} (2,500–4,000 characters, plain text, starts with "SYNTHETIC TEST MATERIAL").
- "notes": the student's own class notes on two core topics, informal, with abbreviations (1,500–2,500 characters).
- "photoText": text as read from a phone photo of a whiteboard or textbook page on one topic, with 5–8 OCR misreads/typos and one "[unreadable]" (500–900 characters).
- "transcript": a lecture transcript on one topic, spoken style with filler words ("um", "so"), one off-topic remark, one announcement with a date, and the phrase "this will be on the exam" once (2,500–3,500 characters).
- "lectureTitle": a short title for that lecture.
- "movedItem": one quiz or exam from the syllabus, with its old date and a new date 3–7 days later, as {"what": "...", "oldDate": "...", "newDate": "..."}.`,
    obj({ syllabus: str, notes: str, photoText: str, transcript: str, lectureTitle: str, movedItem: obj({ what: str, oldDate: str, newDate: str }) }), 'medium');
  mkdirSync(path.join(dir, 'materials'), { recursive: true });
  writeFileSync(file, JSON.stringify(m, null, 2));
  return m;
}

// ---------- 2. One simulated student ----------
const GOALS = (p, m) => [
  `Find out what is coming up next in the course (the next quiz or exam and what it covers).`,
  `Ask for a practice set of about 10 questions on a topic, do it, and get some wrong (the app asks what kind and which topic; answer like ${p.name} would).`,
  `After the score, ask for memory tricks for the misses and answer the "Pop quiz" question (half right is fine).`,
  `Ask for flashcards on the misses.`,
  `Tell the coach a change, in your own words: the ${m.movedItem.what} moved from ${m.movedItem.oldDate} to ${m.movedItem.newDate}.`,
  `Ask about something from the lecture "${m.lectureTitle}".`,
  `Your curveball: ${p.curveball}`,
];

function fakeT() { const after = []; return { after: (fn) => after.push(fn), run: async () => { for (const fn of after.reverse()) { try { await fn(); } catch { /* closing */ } } } }; }

async function runPersona(p) {
  const m = await materialsFor(p);
  const t = fakeT();
  const log = [];
  const problems = [];
  const started = Date.now();
  try {
    const database = await startDatabase(t);
    const { base, signToken } = await startServer(t, 1, {
      DATABASE_URL: database.url,
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ...(process.env.OPENAI_API_KEY ? { AI_INTEGRATIONS_OPENAI_API_KEY: process.env.OPENAI_API_KEY, AI_INTEGRATIONS_OPENAI_BASE_URL: 'https://api.openai.com/v1', AI_PROVIDER_CLASSIC_QUIZ: 'openai' } : {}),
    });
    const user = `sim_${p.id}`;
    await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', [`state-${user}`, user, JSON.stringify({ aiConsent: true, courses: [], materials: [] })]);
    const api = async (method, route, body, headers = {}) => {
      const t0 = Date.now();
      const res = await fetch(`${base}/api${route}`, { method, headers: { Authorization: `Bearer ${signToken(user)}`, ...(body !== undefined && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
      return { status: res.status, body: json, ms: Date.now() - t0 };
    };
    const versions = {};
    const chat = async (content, courseId) => {
      const key = courseId ?? 'general';
      const r = await api('POST', '/study/chat', { content, version: versions[key] ?? 0, ...(courseId ? { courseId } : {}) });
      if (r.status !== 200) { problems.push({ severity: 'high', category: 'error', quote: content, problem: `The chat returned ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}` }); return null; }
      versions[key] = r.body.version;
      const reply = r.body.messages.at(-1);
      log.push({ role: 'student', text: content });
      log.push({ role: 'coach', text: reply.content, chips: reply.suggestions ?? [], actions: (reply.actions ?? []).map((a) => a.type), ms: r.ms });
      if (r.ms > 30_000) problems.push({ severity: 'low', category: 'slow', quote: content, problem: `The coach took ${Math.round(r.ms / 1000)} s to answer.` });
      return { reply, view: r.body };
    };

    // The course, created the way a student would.
    const opening = await ask(STUDENT_MODEL, `You are ${p.name}, ${p.age}, ${p.level} student. Style: ${p.style}`, `You just opened a study app for the first time. Write your first message to its coach, naming ${p.kind === 'exam' ? `the ${p.course} exam you are preparing for` : `your ${p.course} class`}, in your own style. One or two sentences.`, obj({ message: str }));
    const first = await chat(opening.message);
    let courseId = first?.reply.actions?.find((a) => a.type === 'create_course')?.courseId;
    if (!courseId) {
      problems.push({ severity: 'medium', category: 'flow', quote: opening.message, problem: 'The coach did not create the course from the first message; the run created it directly.' });
      const s = (await api('GET', '/study/state')).body;
      courseId = `course-${p.id}`;
      await api('PUT', '/study/state', { state: { ...s.state, courses: [...(s.state.courses ?? []), { id: courseId, name: p.course, kind: p.kind }] }, version: s.version });
    }

    // Uploads, the way the phone saves them: extract (returns the notes), then save with the raw text.
    const upload = async (filename, text) => {
      const r = await api('POST', '/study/materials/extract', Buffer.from(text), { 'Content-Type': 'application/octet-stream', 'X-Filename': filename });
      if (r.status !== 200) { problems.push({ severity: 'high', category: 'upload', quote: filename, problem: `Upload failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}` }); return; }
      if (!r.body.notes) problems.push({ severity: 'medium', category: 'upload', quote: filename, problem: 'No notes came back with the upload.' });
      const s = (await api('GET', '/study/state')).body;
      const saved = await api('PUT', '/study/state', { state: { ...s.state, materials: [...(s.state.materials ?? []), { id: `${p.id}-${filename}`, courseId, name: filename.replace(/\.txt$/, ''), text: r.body.text, ...(r.body.notes ? { notes: r.body.notes } : {}), extractionFormat: 'txt' }] }, version: s.version });
      if (saved.status !== 200) problems.push({ severity: 'high', category: 'upload', quote: filename, problem: `Saving the upload failed (${saved.status}).` });
      log.push({ role: 'app', text: `Uploaded ${filename}: ${r.body.notes ? `${r.body.notes.length} characters of notes from ${r.body.text.length} of text` : 'no notes'}.`, notes: r.body.notes ?? null });
    };
    await upload(p.kind === 'exam' ? 'Study plan.txt' : 'Syllabus.txt', m.syllabus);
    await upload('My notes.txt', m.notes);
    await upload('IMG_4417.txt', m.photoText);
    const lecture = (await api('POST', '/study/lectures', { courseId, title: m.lectureTitle, recordedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), durationSeconds: 3000 })).body;
    if (lecture?.id) {
      const words = m.transcript.split(/(?<=[.?!])\s+/);
      const segments = words.map((text, i) => ({ start: i * 20, end: i * 20 + 19, text }));
      const l1 = (await api('PUT', `/study/lectures/${lecture.id}`, { version: lecture.version, segments })).body;
      await api('PUT', `/study/lectures/${lecture.id}`, { version: l1.version, status: 'reviewed' });
      await new Promise((r) => setTimeout(r, 20_000)); // lecture notes are written in the background
      const ln = (await api('GET', '/study/state')).body.state.materials?.find((x) => x.lectureId === lecture.id);
      log.push({ role: 'app', text: `Recorded and reviewed the lecture "${m.lectureTitle}": ${ln?.notes ? `${ln.notes.length} characters of lecture notes` : 'no lecture notes yet'}.`, notes: ln?.notes ?? null });
      if (!ln?.notes) problems.push({ severity: 'medium', category: 'upload', quote: m.lectureTitle, problem: 'No lecture notes 20 s after the transcript was saved as reviewed.' });
    }

    // The conversation: the student decides each message; sets and decks are played like the app.
    const goals = GOALS(p, m);
    const done = new Set();
    let last = first;
    const playSet = async (sessionId, kind) => {
      let session;
      for (let i = 0; i < 300; i += 1) { // a 50 can take several minutes (D-140)
        session = (await api('GET', `/study/sessions/${sessionId}`)).body;
        if (session?.quiz && session.quiz.status !== 'writing') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      const questions = session?.quiz?.questions ?? [];
      if (!questions.length) { problems.push({ severity: 'high', category: 'set', quote: sessionId, problem: 'The set had no questions.' }); return; }
      const picks = await ask(STUDENT_MODEL, `You are ${p.name}, a ${p.level} student. You know the material about ${Math.round(p.accuracy * 100)}% of the time: answer like that student, getting about ${Math.round((1 - p.accuracy) * 100)}% wrong on the questions you would plausibly miss.`,
        { questions: questions.map((q, i) => ({ index: i, prompt: q.prompt, options: q.options.map((o, j) => `${j}: ${o.text}`) })) },
        obj({ answers: { type: 'array', items: obj({ index: { type: 'integer' }, option: { type: 'integer' } }) } }));
      const missCount = Math.max(1, Math.round(questions.length * (1 - p.accuracy)));
      const flip = new Set([...questions.keys()].sort(() => Math.random() - 0.5).slice(0, missCount));
      for (const a of picks.answers) {
        const q = questions[a.index]; if (!q) continue;
        // The AI playing the student knows the answers, so some picks are moved to another option on purpose.
        const chosenIndex = Math.max(0, Math.min(3, a.option));
        const o = q.options[flip.has(a.index) ? (chosenIndex + 1 + Math.floor(Math.random() * 3)) % 4 : chosenIndex];
        await api('PUT', `/study/sessions/${sessionId}/answers`, { questionId: q.id, optionId: o.id, assisted: false });
      }
      const graded = await api('POST', `/study/sessions/${sessionId}/grade`);
      const grade = graded.body?.quiz?.grade;
      log.push({ role: 'app', text: `${kind} set: ${questions.length} questions, ${grade ? `${grade.correct} of ${grade.answered} right` : `grading failed (${graded.status})`}.`, questions: graded.body?.quiz?.questions?.map((q) => ({ prompt: q.prompt, chose: q.feedback?.selectedOptionText, correct: q.feedback?.correctOptionText, explanation: q.feedback?.explanation })) });
      if (!grade) problems.push({ severity: 'high', category: 'set', quote: sessionId, problem: `Grading failed (${graded.status}).` });
      done.add(1);
      return chat('I finished the set.', courseId);
    };
    const playDeck = async (sessionId) => {
      const session = (await api('GET', `/study/sessions/${sessionId}`)).body;
      const cards = session?.flashcards?.cards ?? [];
      if (!cards.length) { problems.push({ severity: 'high', category: 'deck', quote: sessionId, problem: 'The deck had no cards.' }); return null; }
      for (const [i, c] of cards.entries()) await api('POST', `/study/sessions/${sessionId}/flashcards/${c.id}/review`, { result: i < 2 ? 'again' : 'got' });
      for (const c of cards.slice(0, 2)) await api('POST', `/study/sessions/${sessionId}/flashcards/${c.id}/review`, { result: 'got' });
      log.push({ role: 'app', text: `Flashcards: ${cards.length} cards (2 needed a second look).`, cards: cards.map((c) => ({ front: c.front, back: c.back })) });
      done.add(3);
      return chat('I finished the flashcards.', courseId);
    };

    for (let turn = 0; turn < TURNS && last; turn += 1) {
      const started = last.reply.actions?.find((a) => a.type === 'start_quiz' || a.type === 'start_flashcards');
      if (started?.type === 'start_quiz') { last = await playSet(started.sessionId, started.kind ?? 'practice'); continue; }
      if (started?.type === 'start_flashcards') { last = await playDeck(started.sessionId); continue; }
      const remaining = goals.map((g, i) => ({ i, g })).filter(({ i }) => !done.has(i));
      if (!remaining.length) break;
      const next = await ask(STUDENT_MODEL,
        `You are ${p.name}, ${p.age}, a ${p.level} student using a study app's AI coach on your phone. Style: ${p.style} Stay in character; never say you are a test or an AI. Today is ${TODAY}.`,
        { yourGoalsStillOpen: remaining, recentConversation: log.filter((x) => x.role !== 'app').slice(-6).map((x) => `${x.role}: ${x.text}`), coachsLastReply: last.reply.content, chipsYouCanTap: last.reply.suggestions ?? [],
          instructions: 'Choose your next move toward one open goal, in order unless the conversation leads elsewhere. Either tap a chip (copy its exact text) or type a message in your own style. Answer the coach\'s question if it asked one. If your move finishes a goal, give its index in "completesGoal", else -1.' },
        obj({ tap: { type: 'boolean' }, text: str, completesGoal: { type: 'integer' } }));
      if (next.tap && !(last.reply.suggestions ?? []).includes(next.text)) next.tap = false;
      if (next.completesGoal >= 0 && next.completesGoal !== 1 && next.completesGoal !== 3) done.add(next.completesGoal);
      if (next.tap) log.push({ role: 'app', text: `(tapped the chip "${next.text}")` });
      last = await chat(next.text, courseId);
    }
    if (!done.has(1)) problems.push({ severity: 'medium', category: 'flow', quote: '', problem: 'The student never got a practice set started and finished within the turns.' });
    const state = (await api('GET', '/study/state')).body.state;
    const course = state.courses.find((c) => c.id === courseId);
    return { persona: p, log, problems, materials: m, courseNotes: course?.notes?.text ?? '', seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) {
    problems.push({ severity: 'high', category: 'crash', quote: '', problem: `The run stopped: ${error instanceof Error ? error.message : String(error)}` });
    return { persona: p, log, problems, materials: m, courseNotes: '', seconds: Math.round((Date.now() - started) / 1000) };
  } finally {
    await t.run();
  }
}

// ---------- 3. Grading ----------
const CHECKLIST = [
  'Wrong or invented facts: dates, deadlines, grading or policies not in the materials or in what the student said; wrong subject facts; an answer key that does not match its explanation.',
  'Dead ends: a coach reply that leaves the student without a clear next step (no useful chips and no question), or chips that do not match what the coach asked.',
  'Hard to read: walls of text, long paragraphs, memory tricks that are not short "Term = trick" lines, lines over ~14 words in a tricks list.',
  'Lost context: forgetting the course, mixing up topics, ignoring what the student just said, repeating itself.',
  'Tone and safety: condescending, preachy, or unhelpful; anything inappropriate for the student\'s age (high schoolers are 15–17); refusing reasonable study help.',
  'App behavior: the course not created from the first message, uploads without notes, a set or deck that failed, the moved date not saved or not remembered, slow replies.',
];
function codeChecks(run) {
  const out = [];
  for (const x of run.log) {
    if (x.role !== 'coach') continue;
    const lines = x.text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.some((l) => /^(\*\*)?pop quiz/i.test(l)) && !(x.chips.includes('Show me the answer') && x.chips.length >= 4)) out.push({ severity: 'medium', category: 'dead end', quote: lines.at(-1), problem: `A Pop quiz came with only these chips: ${JSON.stringify(x.chips)}.` });
    if (/quick memory tricks/i.test(x.text)) for (const l of lines) { const n = l.replace(/\*\*/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length; if (n > 16 && !/^(\*\*)?(pop quiz|your turn)/i.test(l)) out.push({ severity: 'low', category: 'readability', quote: l.slice(0, 120), problem: `A memory-trick line runs ${n} words.` }); }
    if (x.text.split(/\s+/).length > 220) out.push({ severity: 'low', category: 'readability', quote: x.text.slice(0, 120), problem: `A reply of ${x.text.split(/\s+/).length} words.` });
  }
  return out;
}
async function grade(run) {
  const verdict = await ask(JUDGE_MODEL,
    'Score the app from 0 to 10 (10 = flawless). You review one conversation between a student and the AI study coach of a phone study app (RapidRecall AI), for a product owner who will fix what you find. Be specific and strict, quote the exact words, and do not invent problems. The materials are synthetic test data. The student is simulated; judge only the app (the coach and the app\'s messages).',
    { student: { name: run.persona.name, age: run.persona.age, level: run.persona.level, course: run.persona.course, curveball: run.persona.curveball }, today: TODAY,
      materialsTheStudentUploaded: { syllabusOrPlan: run.materials.syllabus, notes: run.materials.notes, photoText: run.materials.photoText, lectureTranscript: run.materials.transcript },
      noteToJudge: 'Anything the coach says that appears in ANY of these materials (including announcements in the lecture transcript) is grounded, not invented. Only flag facts found in none of them and not said by the student.',
      movedItem: run.materials.movedItem, courseNotesAtTheEnd: run.courseNotes,
      conversation: run.log, checklist: CHECKLIST },
    obj({ score: { type: 'integer', description: 'Overall quality from 0 (broken) to 10 (flawless)' }, summary: str, issues: { type: 'array', items: obj({ severity: { type: 'string', enum: ['high', 'medium', 'low'] }, category: str, quote: str, problem: str, fix: str }) }, strengths: { type: 'array', items: str } }), 'medium');
  return { ...verdict, issues: [...run.problems, ...codeChecks(run), ...verdict.issues] };
}

// ---------- 4. Report ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function report(results, tokens) {
  const count = (r, s) => r.grade.issues.filter((i) => i.severity === s).length;
  const rows = results.map((r) => `<tr><td>${esc(r.persona.name)} · ${esc(r.persona.course)}</td><td class="n">${r.grade.score}/10</td><td class="n hi">${count(r, 'high')}</td><td class="n">${count(r, 'medium')}</td><td class="n">${count(r, 'low')}</td></tr>`).join('');
  const sections = results.map((r) => `<section><h2>${esc(r.persona.name)}, ${r.persona.age} · ${esc(r.persona.course)} <span class="score">${r.grade.score}/10</span></h2>
<p>${esc(r.grade.summary)}</p>
${r.grade.issues.length ? `<ul class="issues">${r.grade.issues.map((i) => `<li class="${i.severity}"><b>${esc(i.severity)} · ${esc(i.category)}</b> ${esc(i.problem)}${i.quote ? `<blockquote>${esc(i.quote)}</blockquote>` : ''}${i.fix ? `<div class="fix">Fix: ${esc(i.fix)}</div>` : ''}</li>`).join('')}</ul>` : '<p>No issues found.</p>'}
${r.grade.strengths?.length ? `<p class="good">Worked well: ${r.grade.strengths.map(esc).join(' · ')}</p>` : ''}
<details><summary>Full conversation (${r.log.length} steps, ${r.seconds} s)</summary>${r.log.map((x) => `<div class="msg ${x.role}"><b>${x.role}</b> ${esc(x.text).replace(/\n/g, '<br>')}${x.chips?.length ? `<div class="chips">${x.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div>`).join('')}</details></section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulated students report</title>
<style>:root{--bg:#fafaf7;--fg:#1d2430;--muted:#5d6675;--line:#e3e0d8;--hi:#b3261e;--med:#a35c00;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e9edf2;--muted:#a3adba;--line:#2c323b;--hi:#ff8a80;--med:#ffb340;--card:#1b1f26}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:860px;padding:16px}h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left}.n{text-align:right}.hi{color:var(--hi);font-weight:700}.score{color:var(--muted);font-weight:400}
.issues{padding-left:1.1rem}.issues li{margin:.6rem 0}.issues li.high b{color:var(--hi)}.issues li.medium b{color:var(--med)}blockquote{margin:.3rem 0;padding-left:.7rem;border-left:3px solid var(--line);color:var(--muted)}.fix{color:var(--muted);font-size:.92rem}.good{color:var(--muted)}
details{margin-top:.6rem}.msg{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0}.msg.student{margin-left:12%}.msg.app{color:var(--muted);font-size:.9rem}.chips span{display:inline-block;border:1px solid var(--line);border-radius:12px;padding:1px 8px;margin:3px 4px 0 0;font-size:.85rem}</style></head>
<body><h1>Simulated students report</h1><p>${TODAY} · ${results.length} personas · ${Math.round(tokens.input / 1000)}k input and ${Math.round(tokens.output / 1000)}k output tokens for the students and the judge (the app's own AI calls are extra) · synthetic materials only.</p>
<table><tr><th>Student</th><th class="n">Score</th><th class="n">High</th><th class="n">Medium</th><th class="n">Low</th></tr>${rows}</table>${sections}</body></html>`;
}

// ---------- main ----------
const regrade = opt('regrade');
if (regrade) {
  const saved = JSON.parse(readFileSync(regrade, 'utf8'));
  const results = await Promise.all(saved.map(async (r) => {
    const persona = personas.find((x) => x.id === r.persona);
    const run = { persona, log: r.log, problems: (r.problems ?? r.issues.filter((i) => ['error', 'upload', 'set', 'deck', 'flow', 'crash', 'slow'].includes(i.category))), materials: await materialsFor(persona), courseNotes: r.courseNotes ?? '', seconds: r.seconds ?? 0 };
    return { ...run, grade: await grade(run) };
  }));
  const out = regrade.replace(/\.json$/, '-regraded.html');
  writeFileSync(out, report(results, usage));
  writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify(results.map((r) => ({ persona: r.persona.id, score: r.grade.score, summary: r.grade.summary, issues: r.grade.issues, log: r.log, problems: r.problems, courseNotes: r.courseNotes, seconds: r.seconds })), null, 2));
  for (const r of results) console.log(`  ${r.persona.name}: ${r.grade.score}/10, ${r.grade.issues.filter((i) => i.severity === 'high').length} high, ${r.grade.issues.filter((i) => i.severity === 'medium').length} medium`);
  console.log(`Report: ${out}`);
  process.exit(0);
}
console.log(`Simulated students: ${chosen.join(', ')} (${TURNS} turns each)`);
buildServer();
const CONCURRENCY = Number(opt('parallel') ?? 3);
const queue = chosen.map((id) => personas.find((x) => x.id === id)).filter(Boolean);
const results = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let p = queue.shift(); p; p = queue.shift()) {
    console.log(`- ${p.name} (${p.course}) started`);
    const run = await runPersona(p);
    const g = await grade(run);
    results.push({ ...run, grade: g });
    console.log(`  ${p.name}: ${g.score}/10, ${g.issues.filter((i) => i.severity === 'high').length} high, ${g.issues.filter((i) => i.severity === 'medium').length} medium, ${g.issues.filter((i) => i.severity === 'low').length} low (${run.seconds} s)`);
  }
}));
results.sort((a, b) => chosen.indexOf(a.persona.id) - chosen.indexOf(b.persona.id));
// Tokens used by the simulated students and the judge (the app's own AI calls are not counted here).
const cost = usage;
mkdirSync(path.join(dir, 'reports'), { recursive: true });
const out = path.join(dir, 'reports', `${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
writeFileSync(out, report(results, cost));
writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify(results.map((r) => ({ persona: r.persona.id, score: r.grade.score, summary: r.grade.summary, issues: r.grade.issues, log: r.log, problems: r.problems, courseNotes: r.courseNotes, seconds: r.seconds })), null, 2));
console.log(`Report: ${out}`);
