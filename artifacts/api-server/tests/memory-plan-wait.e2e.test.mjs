// End-to-end (D-221, Dan: "still no pictures"): the student taps "Go over my misses" while the memory coach is still
// writing the plan, and the plan takes longer than the old 10-second wait. The walk's first reply now waits for it
// (sending comment lines so the phone keeps the connection), then teaches with the plan and carries the picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';
import { startDatabase } from './helpers/database.mjs';

const chatReply = (content) => ({
  status: 200,
  body: {
    id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'stub',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  },
});
const quizReply = () => chatReply(JSON.stringify({ questions: Array.from({ length: 4 }, (_, i) => ({
  prompt: `${['Which membrane process', 'What organelle makes', 'How does the cell divide', 'Where is energy stored'][i]} in picture case ${i}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Because ${i}.`,
})) }));
const pickText = (q, text) => q.options.find((o) => o.text === text).id;
const SCENE = 'Two cats side by side: the left one with a dashed red box around it, the right one coloured in solid blue.';
const IMAGE = Buffer.from('fake webp bytes').toString('base64');

const eventsOf = (text) => text.split('\n\n').filter(Boolean).map((block) => ({
  comment: block.startsWith(':'),
  event: /^event: (.+)$/m.exec(block)?.[1],
  data: /^data: (.+)$/m.exec(block)?.[1] ? JSON.parse(/^data: (.+)$/m.exec(block)[1]) : null,
}));

test('a slow plan: the walk waits past 10 seconds for it and still shows the picture', { timeout: 60_000 }, async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let releasePlan;
  const planGate = new Promise((resolve) => { releasePlan = resolve; });
  const coachFor = (system, last) => {
    if (last === 'Quiz me') return { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }], teaching: 0 };
    if (last === 'I finished the set.') return { reply: "### 🎯 Coach's evaluation\n- **2 of 4 (50%).**", suggestions: [], actions: [], teaching: 0 };
    if (system.includes('Start now with miss 1')) return { reply: 'First one.\n\n### 🧠 Memory hack\n\n**Picture it.** Two cats.\n\nGot it?', suggestions: [], actions: [], teaching: 1 };
    return { reply: 'Hello.', suggestions: [], actions: [], teaching: 0 };
  };
  const ai = await startAiStub(t, async (request) => {
    if (request.path.includes('/images/generations')) return { status: 200, body: { created: 0, data: [{ b64_json: IMAGE }] } };
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return quizReply();
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('You write rows for a student')) return chatReply(JSON.stringify({ rows: [] }));
    if (system.startsWith('A student has challenged')) return chatReply(JSON.stringify({ choice: 0, confidence: 'high', explanation: 'The key holds.' }));
    if (system.startsWith('You are the memory coach')) {
      await planGate; // the slow plan
      const { misses } = JSON.parse(request.body.messages.at(-1).content);
      return chatReply(JSON.stringify({ technique_plan: misses.map(() => 'visual_scene'), set_note: '', cards: misses.map((m, i) => ({
        question_id: m.question_id, diagnosis: 'CONFUSION', technique: i === 0 ? 'visual_scene' : 'analogy', headline: `Remember ${m.concept}`, why_you_missed: `Tempting ${m.concept}.`,
        correct_answer: '', memory_tool: `Tool for ${m.concept}.`, recall_cue: '', visual_cue: '', lock_in: { prompt: '', answer: '' }, nudges: [], key_concern: '',
        picture: i === 0 ? SCENE : '',
      })) }));
    }
    const last = request.body.messages.at(-1).content;
    return chatReply(JSON.stringify(coachFor(system, typeof last === 'string' ? last : '')));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_w', 'user_w', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_w')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const say = async (content, version) => {
    const res = await call('POST', '/study/chat', { content, version, courseId: 'bio' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };

  let chat = await say('Quiz me', 0);
  const id = chat.messages.at(-1).actions[0].sessionId;
  let session = (await call('GET', `/study/sessions/${id}`)).body;
  for (const [i, text] of ['B0', 'A1', 'C2', 'A3'].entries()) {
    const question = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${id}/answers`, { questionId: question.id, optionId: pickText(question, text), assisted: false })).body;
  }
  assert.equal((await call('POST', `/study/sessions/${id}/grade`)).status, 200);
  const q0 = session.quiz.questions[0].id;
  chat = await say('I finished the set.', chat.version);

  // The plan is still being written when the walk starts; it lands after 12 seconds (the old wait gave up at 10).
  const started = Date.now();
  setTimeout(() => releasePlan(), 12_000);
  const res = await fetch(`${base}/api/study/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_w')}` }, body: JSON.stringify({ content: 'Go over my misses', version: chat.version, courseId: 'bio' }) });
  assert.equal(res.status, 200);
  const events = eventsOf(await res.text());
  assert.ok(Date.now() - started >= 12_000, 'it waited for the plan');
  assert.ok(events.filter((e) => e.comment).length >= 2, 'comment lines kept the connection busy while it waited');
  const done = events.find((e) => e.event === 'done');
  assert.ok(done, JSON.stringify(events.slice(-2)));
  const prompt = ai.requests.map((r) => r.body?.messages?.[0]?.content ?? '').filter((s) => s.includes('You are the study coach')).at(-1);
  assert.ok(prompt.includes(`a picture of this is shown under your Memory hack: ${SCENE}`), 'the coach taught with the plan');
  assert.deepEqual(done.data.messages.at(-1).picture, { sessionId: id, questionId: q0 });
});
