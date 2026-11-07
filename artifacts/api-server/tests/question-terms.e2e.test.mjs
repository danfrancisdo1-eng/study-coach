// End-to-end (D-226): the question writer's terms reach the app on each question (session-quiz.v13), minus any
// term that would give the answer away; questions without terms simply have none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const chatReply = (content) => ({
  status: 200,
  body: { id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } },
});
const QUESTIONS = [
  { prompt: 'Which process moves water across a semipermeable membrane from low to high solute concentration?', options: ['Osmosis', 'Active transport', 'Endocytosis', 'Exocytosis'], answerIndex: 0, concept: 'osmosis', explanation: 'Water moves by osmosis.', hook: 'Water chases salt.',
    terms: [{ term: 'semipermeable membrane', definition: 'A barrier that lets some molecules through but not others.' }, { term: 'solute', definition: 'A substance dissolved in a liquid, like salt in water.' }] },
  { prompt: 'Which organelle makes most of the ATP in a eukaryotic cell?', options: ['Mitochondrion', 'Ribosome', 'Golgi apparatus', 'Lysosome'], answerIndex: 0, concept: 'mitochondria', explanation: 'The mitochondrion runs cellular respiration.', hook: 'Powerhouse.',
    terms: [{ term: 'ATP', definition: 'The energy molecule made in the mitochondrion.' }, { term: 'eukaryotic', definition: 'Having a nucleus and membrane-bound organelles.' }] },
  { prompt: 'Which phase of mitosis lines chromosomes up in the middle of the cell?', options: ['Metaphase', 'Prophase', 'Anaphase', 'Telophase'], answerIndex: 0, concept: 'metaphase', explanation: 'Metaphase: middle.', hook: 'M for middle.', terms: [] },
  { prompt: 'Where is genetic information stored in a eukaryotic cell?', options: ['Nucleus', 'Cell wall', 'Vacuole', 'Cytoplasm'], answerIndex: 0, concept: 'nucleus', explanation: 'DNA lives in the nucleus.', hook: 'Nucleus = notebook.', terms: [] },
];

test('a question\'s terms reach the app; a term that gives the answer away is dropped', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const ai = await startAiStub(t, async (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return chatReply(JSON.stringify({ questions: QUESTIONS }));
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('You write rows for a student')) return chatReply(JSON.stringify({ rows: [] }));
    const last = request.body.messages.at(-1).content;
    if (last === 'Quiz me') return chatReply(JSON.stringify({ reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }], teaching: 0 }));
    return chatReply(JSON.stringify({ reply: 'Hello.', suggestions: [], actions: [], teaching: 0 }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_t', 'user_t', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_t')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const chat = (await call('POST', '/study/chat', { content: 'Quiz me', version: 0, courseId: 'bio' })).body;
  const id = chat.messages.at(-1).actions[0].sessionId;
  let session;
  for (let i = 0; i < 50; i += 1) {
    session = (await call('GET', `/study/sessions/${id}`)).body;
    if (session.quiz?.questions?.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const byConcept = Object.fromEntries(session.quiz.questions.map((q) => [q.concept, q]));
  const writerPrompt = ai.requests.map((r) => r.body?.messages?.[0]?.content ?? '').find((s) => s.includes('Create exactly'));
  assert.match(writerPrompt, /"terms":\[\{"term":string,"definition":string\}\]/, 'the writer is asked for terms (v13)');
  assert.deepEqual(byConcept.osmosis.terms.map((x) => x.term), ['semipermeable membrane', 'solute']);
  assert.match(byConcept.osmosis.terms[0].definition, /lets some molecules through/);
  assert.deepEqual(byConcept.mitochondria.terms.map((x) => x.term), ['eukaryotic'], 'the ATP definition names the answer, so it is dropped');
  assert.equal('terms' in byConcept.metaphase, false, 'no terms: no field');
  assert.equal('correctOptionId' in byConcept.osmosis, false, 'still no answer key before answering');
});
