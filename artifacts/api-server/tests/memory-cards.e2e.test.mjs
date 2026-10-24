// End-to-end (D-194): grading a set with misses starts the memory coach in the background; the
// session shows "writing", then the checked cards (key text, no nudges); a set with no misses has none.
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
let round = 0;
const quizReply = () => chatReply(JSON.stringify({ questions: Array.from({ length: 4 }, (_, i) => ({
  prompt: `Round ${round} ${['Which membrane process', 'What organelle makes', 'How does the cell divide', 'Where is energy stored'][i]} in case ${round * 7 + i}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: 0, concept: `concept-${i}`, explanation: `Because ${i}.`,
})) }));
const pickText = (q, text) => q.options.find((o) => o.text === text).id;

test('a graded set with misses gets memory cards; a perfect set gets none', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let releaseCheck;
  const checkGate = new Promise((resolve) => { releaseCheck = resolve; });
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  const ai = await startAiStub(t, async (request) => {
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) { round += 1; return quizReply(); }
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('You write rows for a student')) return chatReply(JSON.stringify({ rows: [] }));
    if (system.startsWith('A student has challenged')) { await checkGate; return chatReply(JSON.stringify({ choice: 0, confidence: 'high', explanation: 'The key holds.' })); }
    if (system.startsWith('You are the memory coach')) {
      await gate;
      const { misses } = JSON.parse(request.body.messages.at(-1).content);
      return chatReply(JSON.stringify({
        set_note: 'Two right; these cards target the other two.',
        cards: misses.map((m) => ({
          question_id: m.question_id, diagnosis: 'CONFUSION', technique: 'contrast_pair', headline: `Remember ${m.concept}`,
          why_you_missed: 'They look alike.', correct_answer: 'made up', memory_tool: `${m.concept}: the A one, never the B one.`,
          recall_cue: 'A not B', visual_cue: 'An A on a door.', lock_in: { prompt: 'Which letter?', answer: 'A' },
          nudges: ['Which letter wins?', 'A or B?', 'Door letter?'], key_concern: '',
        })),
      }));
    }
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_m', 'user_m', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114', notes: { text: 'concept-0 is about A0.\n\nUnrelated paragraph.', change: '', updatedAt: '', history: [] } }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_m')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const playSet = async (version, picks) => {
    const chat = await call('POST', '/study/chat', { content: 'Quiz me', version, courseId: 'bio' });
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    const id = chat.body.messages.at(-1).actions[0].sessionId;
    let session = (await call('GET', `/study/sessions/${id}`)).body;
    for (const [i, text] of picks.entries()) {
      const question = session.quiz.questions[i];
      session = (await call('PUT', `/study/sessions/${id}/answers`, { questionId: question.id, optionId: pickText(question, text), assisted: false })).body;
    }
    const graded = await call('POST', `/study/sessions/${id}/grade`);
    assert.equal(graded.status, 200, JSON.stringify(graded.body));
    return { id, graded: graded.body };
  };

  // Two misses (B0, C2): the grade comes back at once with the cards "writing".
  const { id, graded } = await playSet(0, ['B0', 'A1', 'C2', 'A3']);
  assert.equal(graded.quiz.grade.correct, 2);
  assert.equal(graded.memoryCards.status, 'writing');
  // A report starts right after grading and is still in its re-check when the cards land: neither write loses.
  const missed = graded.quiz.questions[0];
  const report = call('PUT', `/study/sessions/${id}/questions/${missed.id}/flag`, { kind: 'wrong_answer' });
  await new Promise((r) => setTimeout(r, 200));
  release();
  let session;
  for (let i = 0; i < 50; i += 1) {
    session = (await call('GET', `/study/sessions/${id}`)).body;
    if (session.memoryCards?.status !== 'writing') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(session.memoryCards.status, 'ready', JSON.stringify(session.memoryCards));
  releaseCheck();
  const reported = await report;
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  assert.ok(reported.body.quiz.questions[0].flag.recheck?.verdict);
  session = (await call('GET', `/study/sessions/${id}`)).body;
  assert.equal(session.quiz.questions[0].flag.recheck.verdict, reported.body.quiz.questions[0].flag.recheck.verdict);
  assert.equal(session.memoryCards.status, 'ready');
  assert.equal(session.memoryCards.setNote, 'Two right; these cards target the other two.');
  assert.deepEqual(session.memoryCards.cards.map((c) => c.concept), ['concept-0', 'concept-2']);
  const [first] = session.memoryCards.cards;
  assert.equal(first.correctAnswer, 'A0'); // the key, not the model's text
  assert.equal(first.techniqueLabel, 'Side by side');
  assert.equal('nudges' in first, false);

  // What the memory coach was given: the two misses with the chosen and right answers, and the matching notes.
  const request = ai.requests.find((r) => r.body.messages[0].content.startsWith('You are the memory coach'));
  assert.match(request.body.messages[0].content, /BIOL 114/);
  const input = JSON.parse(request.body.messages.at(-1).content);
  assert.deepEqual(input.misses.map((m) => [m.user_answer, m.correct_answer]), [['B0', 'A0'], ['C2', 'A2']]);
  assert.equal(input.courseNotes, 'concept-0 is about A0.');

  // A perfect set: no memory coach call, no cards.
  const before = ai.requests.filter((r) => r.body.messages[0].content.startsWith('You are the memory coach')).length;
  const perfect = await playSet(1, ['A0', 'A1', 'A2', 'A3']);
  assert.equal(perfect.graded.memoryCards, null);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ai.requests.filter((r) => r.body.messages[0].content.startsWith('You are the memory coach')).length, before);
});
