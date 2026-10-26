// End-to-end (D-203): after a graded set with misses the report card's one chip is "Go over my misses";
// sending it (the app does, by itself) is not drawn, and the coach goes over the misses one per reply with
// the memory cards as its plan: "Got it" moves on, "Not yet" stays, a greeting picks up where it stopped,
// the wrap-up ends it.
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
  prompt: `${['Which membrane process', 'What organelle makes', 'How does the cell divide', 'Where is energy stored'][i]} in lesson case ${i}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Because ${i}.`,
})) }));
const pickText = (q, text) => q.options.find((o) => o.text === text).id;

test('the coach goes over the misses one per reply after the report card', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  // What the coach stub answers, by what its prompt says.
  const coachFor = (system, last) => {
    if (last === 'Quiz me') return { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }], teaching: 0 };
    if (last === 'I finished the set.') return { reply: "### 🎯 Coach's evaluation\n- **2 of 4 (50%).**", suggestions: ['Memory tips for the misses'], actions: [], teaching: 0 };
    if (system.includes('Start now with miss 1')) return { reply: 'First one. Got it?', suggestions: [], actions: [], teaching: 1 };
    if (system.includes('Your last reply taught miss 1 of 2')) return last === 'Not yet'
      ? { reply: 'Another angle on the first one. Make sense?', suggestions: [], actions: [], teaching: 1 }
      : { reply: 'Nice. Next one. Got it?', suggestions: [], actions: [], teaching: 2 };
    if (system.includes('Your last reply taught miss 2, the last one')) return { reply: "That was the last one. Next step: a set on just those.", suggestions: ['Another set on the missed topics', 'Another set on everything', 'Flashcards for the misses'], actions: [], teaching: 0 };
    return { reply: 'Hello.', suggestions: [], actions: [], teaching: 0 };
  };
  const ai = await startAiStub(t, async (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return quizReply();
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('You write rows for a student')) return chatReply(JSON.stringify({ rows: [] }));
    if (system.startsWith('You are the memory coach')) {
      const { misses } = JSON.parse(request.body.messages.at(-1).content);
      // The cards come back in a different order than the set: the walk follows the cards.
      return chatReply(JSON.stringify({ set_note: '', cards: [...misses].reverse().map((m) => ({
        question_id: m.question_id, diagnosis: 'CONFUSION', technique: 'analogy', headline: `Remember ${m.concept}`, why_you_missed: `Tempting ${m.concept}.`,
        correct_answer: '', memory_tool: `Tool for ${m.concept}.`, recall_cue: '', visual_cue: '', lock_in: { prompt: '', answer: '' }, nudges: [], key_concern: '',
      })) }));
    }
    const messages = request.body.messages;
    const last = messages.at(-1).content;
    return chatReply(JSON.stringify(coachFor(system, typeof last === 'string' ? last : '')));
  });
  // A 0-minute gap: every open of the app adds the "Welcome back" greeting (to test picking up the walk).
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, HOME_CHAT_SESSION_GAP_MINUTES: '0' });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_l', 'user_l', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_l')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const say = async (content, version) => {
    const res = await call('POST', '/study/chat', { content, version, courseId: 'bio' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  const coachPrompts = () => ai.requests.map((r) => r.body.messages[0].content).filter((s) => s.includes('You are the study coach'));

  let chat = await say('Quiz me', 0);
  const id = chat.messages.at(-1).actions[0].sessionId;
  let session = (await call('GET', `/study/sessions/${id}`)).body;
  for (const [i, text] of ['B0', 'A1', 'C2', 'A3'].entries()) {
    const question = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${id}/answers`, { questionId: question.id, optionId: pickText(question, text), assisted: false })).body;
  }
  assert.equal((await call('POST', `/study/sessions/${id}/grade`)).status, 200);

  // The report card: whatever chips the coach wrote, the one chip with misses starts the walk.
  chat = await say('I finished the set.', chat.version);
  assert.deepEqual(chat.messages.at(-1).suggestions, ['Go over my misses']);
  assert.ok(!coachPrompts().at(-1).includes('Going over the misses (D-203)'));

  // "Go over my misses": not drawn; the first miss is the cards' first (concept-2), with its plan.
  chat = await say('Go over my misses', chat.version);
  assert.ok(!chat.messages.some((m) => m.content === 'Go over my misses'), 'the app-sent message is not shown');
  assert.ok(chat.messages.every((m) => !('lesson' in m) && !('hidden' in m)), 'the bookkeeping stays on the server');
  assert.equal(chat.messages.at(-1).content, 'First one. Got it?');
  assert.deepEqual(chat.messages.at(-1).suggestions, ['Got it', 'Not yet']);
  let prompt = coachPrompts().at(-1);
  assert.match(prompt, /1\. Q: How does the cell divide in lesson case 2\? \| they chose: C2 \| right answer: A2 .*the plan: why it was tempting: Tempting concept-2\./);
  assert.match(prompt, /2\. Q: Which membrane process in lesson case 0\? \| they chose: B0 \| right answer: A0/);
  // The coach still sees the student's turn.
  const lastRequest = ai.requests.filter((r) => r.body.messages[0].content.includes('You are the study coach')).at(-1).body.messages;
  assert.equal(lastRequest.at(-1).content, 'Go over my misses');

  // "Not yet": the same miss again.
  chat = await say('Not yet', chat.version);
  assert.equal(chat.messages.at(-1).content, 'Another angle on the first one. Make sense?');
  assert.deepEqual(chat.messages.at(-1).suggestions, ['Got it', 'Not yet']);

  // Away and back: the greeting offers to pick up where it stopped, and the walk goes on from it.
  const opened = await call('POST', '/study/chat/open', { courseId: 'bio' });
  assert.equal(opened.status, 200);
  assert.match(opened.body.messages.at(-1).content, /We were going over the ones you missed on cells: that was 1 of 2\. Got that one, or want it again\?/);
  assert.deepEqual(opened.body.messages.at(-1).suggestions, ['Got it', 'Not yet']);

  chat = await say('Got it', opened.body.version);
  assert.equal(chat.messages.at(-1).content, 'Nice. Next one. Got it?');
  prompt = coachPrompts().at(-1);
  assert.match(prompt, /Your last reply taught miss 1 of 2/);

  // After the last one: the wrap-up keeps the coach's chips, and the walk is over.
  chat = await say('yes', chat.version);
  assert.equal(chat.messages.at(-1).content, 'That was the last one. Next step: a set on just those.');
  assert.deepEqual(chat.messages.at(-1).suggestions, ['Another set on the missed topics', 'Another set on everything', 'Flashcards for the misses']);
  chat = await say('thanks', chat.version);
  assert.ok(!coachPrompts().at(-1).includes('Going over the misses (D-203)'), 'no walk after the wrap-up');
});
