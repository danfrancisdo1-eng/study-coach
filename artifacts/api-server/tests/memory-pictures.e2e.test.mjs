// End-to-end (D-216): after grading, a memory card that asks for a picture gets one drawn by the image model in the
// background; GET .../pictures/{questionId} says "drawing", then gives it; a later save keeps it; it is never sent
// inside the session; the reply that first teaches that miss carries it, a "not yet" re-explanation does not.
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

test('a pictured memory card gets its picture, and the reply that first teaches it carries it', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let releaseImage;
  const imageGate = new Promise((resolve) => { releaseImage = resolve; });
  const coachFor = (system, last) => {
    if (last === 'Quiz me') return { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }], teaching: 0 };
    if (last === 'I finished the set.') return { reply: "### 🎯 Coach's evaluation\n- **2 of 4 (50%).**", suggestions: [], actions: [], teaching: 0 };
    if (system.includes('Start now with miss 1')) return { reply: 'First one.\n\n### 🧠 Memory hack\n\n**Picture it.** Two cats.\n\nGot it?', suggestions: [], actions: [], teaching: 1 };
    if (system.includes('Your last reply taught miss 1 of 2')) return last === 'Not yet'
      ? { reply: 'Another angle. Make sense?', suggestions: [], actions: [], teaching: 1 }
      : { reply: 'Nice. Next one. Got it?', suggestions: [], actions: [], teaching: 2 };
    return { reply: 'Hello.', suggestions: [], actions: [], teaching: 0 };
  };
  const ai = await startAiStub(t, async (request) => {
    if (request.path.includes('/images/generations')) {
      await imageGate;
      return { status: 200, body: { created: 0, data: [{ b64_json: IMAGE }] } };
    }
    const system = request.body.messages[0].content;
    if (system.includes('Create exactly')) return quizReply();
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    if (system.startsWith('You write rows for a student')) return chatReply(JSON.stringify({ rows: [] }));
    if (system.startsWith('A student has challenged')) return chatReply(JSON.stringify({ choice: 0, confidence: 'high', explanation: 'The key holds.' }));
    if (system.startsWith('You are the memory coach')) {
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
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_p', 'user_p', JSON.stringify({ aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] })]);
  const call = async (method, path, body, user = 'user_p') => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(user)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  const [q0, , q2] = session.quiz.questions.map((q) => q.id);

  // While the image model works: "drawing".
  let picture;
  for (let i = 0; i < 50; i += 1) {
    picture = (await call('GET', `/study/sessions/${id}/pictures/${q0}`)).body;
    if (picture.status === 'drawing' && ai.requests.some((r) => r.path.includes('/images/generations'))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(picture.status, 'drawing', JSON.stringify(picture));
  releaseImage();
  for (let i = 0; i < 50; i += 1) {
    picture = (await call('GET', `/study/sessions/${id}/pictures/${q0}`)).body;
    if (picture.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(picture, { status: 'ready', mimeType: 'image/webp', data: IMAGE });

  // What the image model was asked: the fixed template around the scene, small webp, the default model.
  const images = ai.requests.filter((r) => r.path.includes('/images/generations'));
  assert.equal(images.length, 1, 'one picture: only the card that asked for one');
  assert.equal(images[0].body.model, 'gpt-image-1');
  assert.equal(images[0].body.prompt, `A simple, friendly flat illustration on a plain light background: ${SCENE.replace(/\.$/, '')}. No text, letters, numbers, labels, logos or watermarks. Safe for a 13-year-old.`);
  assert.equal(images[0].body.size, '1536x1024');
  assert.equal(images[0].body.output_format, 'webp');
  assert.equal(images[0].body.quality, 'low');

  // The other miss has none; another account cannot read it; the session never carries the pictures.
  assert.deepEqual((await call('GET', `/study/sessions/${id}/pictures/${q2}`)).body, { status: 'none' });
  assert.equal((await call('GET', `/study/sessions/${id}/pictures/${q0}`, undefined, 'someone_else')).status, 404);
  session = (await call('GET', `/study/sessions/${id}`)).body;
  assert.equal('memoryPictures' in session, false);
  assert.equal(session.memoryCards.cards[0].picture, SCENE);

  // A save after grading (the check-in) keeps the picture.
  const checked = await call('POST', `/study/sessions/${id}/check-in`, { skipped: true });
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal((await call('GET', `/study/sessions/${id}/pictures/${q0}`)).body.status, 'ready', 'saveSession keeps memoryPictures');

  // The walk: the reply that first teaches the pictured miss carries it, with the scene in the coach's plan.
  chat = await say('I finished the set.', chat.version);
  chat = await say('Go over my misses', chat.version);
  const prompt = ai.requests.map((r) => r.body?.messages?.[0]?.content ?? '').filter((s) => s.includes('You are the study coach')).at(-1);
  assert.ok(prompt.includes(`a picture of this is shown under your Memory hack: ${SCENE}`), 'the coach knows the picture');
  assert.deepEqual(chat.messages.at(-1).picture, { sessionId: id, questionId: q0 });
  chat = await say('Not yet', chat.version);
  assert.equal('picture' in chat.messages.at(-1), false, 'a re-explanation has no picture');
  chat = await say('Got it', chat.version);
  assert.equal('picture' in chat.messages.at(-1), false, 'miss 2 has no picture');
  // The first teaching reply still has it when the chat is read again.
  const reread = (await call('GET', '/study/chat?courseId=bio')).body;
  assert.equal(reread.messages.filter((m) => m.picture).length, 1);
});
