// End-to-end: built server + in-memory Postgres (real migrations) + stub AI.
// The chat-first home (SPEC §7): the coach's reply is stored, its actions are
// validated and applied (course created in study state, session started), accounts
// are isolated, and an AI failure changes nothing.
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

async function seedAccount(db, ownerId, state) {
  await db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', [`state-${ownerId}`, ownerId, JSON.stringify(state)]);
}

test('home chat: greet, create course, start session, isolation, failure safety', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let nextReply = () => chatReply(JSON.stringify({ reply: 'Hey! What class are we working on?', actions: [] }));
  const ai = await startAiStub(t, (request) => nextReply(request));
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_a', { aiConsent: true, courses: [{ id: 'phil', name: 'PHIL 151' }], materials: [] });
  await seedAccount(database.db, 'user_b', { aiConsent: true, courses: [], materials: [] });
  await seedAccount(database.db, 'user_noconsent', { aiConsent: false, courses: [], materials: [] });

  const as = (user) => async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${signToken(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const a = as('user_a');
  const b = as('user_b');

  // Sign-in and consent required; nothing reaches the AI without them.
  assert.equal((await as(null)('GET', '/study/chat')).status, 401);
  assert.equal((await as('user_noconsent')('POST', '/study/chat', { content: 'hi', version: 0 })).status, 403);
  assert.equal((await as('user_new')('POST', '/study/chat', { content: 'hi', version: 0 })).status, 403);
  assert.equal(ai.requests.length, 0);

  // Empty conversation for a fresh account.
  assert.deepEqual((await a('GET', '/study/chat')).body, { messages: [], version: 0, activeQuiz: null, activeDeck: null });
  assert.equal((await a('POST', '/study/chat', { content: '   ', version: 0 })).status, 400);

  // First message: the prompt lists the student's courses; the reply is stored.
  let chat = await a('POST', '/study/chat', { content: 'hi', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.version, 1);
  assert.equal(chat.body.messages.length, 2);
  assert.equal(chat.body.messages[0].role, 'user');
  assert.equal(chat.body.messages[1].content, 'Hey! What class are we working on?');
  assert.deepEqual(chat.body.messages[1].actions, []);
  const system = ai.requests.at(-1).body.messages[0].content;
  assert.match(system, /PHIL 151 \(id phil/);
  assert.match(system, /first visit/i);

  // Naming a class creates it in study state, once, and can start a session on it.
  nextReply = () => chatReply(JSON.stringify({
    reply: "Added BIOL 114. Let's start with a few questions on cells.",
    actions: [
      { type: 'create_course', name: 'BIOL 114', topic: '' },
      { type: 'create_course', name: 'biol 114', topic: '' },
      { type: 'start_session', name: 'BIOL 114', topic: 'Cell structure' },
    ],
  }));
  chat = await a('POST', '/study/chat', { content: "I'm taking BIOL 114", version: 1 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const actions = chat.body.messages.at(-1).actions;
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, 'create_course');
  assert.equal(actions[0].name, 'BIOL 114');
  assert.equal(actions[1].type, 'start_session');
  assert.equal(actions[1].courseId, actions[0].courseId);
  assert.equal(actions[1].topic, 'Cell structure');
  const state = (await a('GET', '/study/state')).body;
  assert.deepEqual(state.state.courses.map((c) => c.name), ['PHIL 151', 'BIOL 114']);
  assert.equal(state.version, 2, 'study state version bumped once');
  const session = await a('GET', `/study/sessions/${actions[1].sessionId}`);
  assert.equal(session.status, 200);
  assert.equal(session.body.courseId, actions[0].courseId);
  assert.equal(session.body.topic, 'Cell structure');
  // The second message's prompt knows about the new course.
  assert.match(ai.requests.at(-1).body.messages[0].content, /PHIL 151/);

  // A session on a course that does not exist is refused without failing the reply.
  nextReply = () => chatReply(JSON.stringify({ reply: 'Opening Chemistry.', actions: [{ type: 'start_session', name: 'Chemistry', topic: 'moles' }] }));
  chat = await a('POST', '/study/chat', { content: 'quiz me on chemistry', version: 2 });
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body.messages.at(-1).actions, []);

  // Stale version: 409, nothing sent to the AI.
  const before = ai.requests.length;
  assert.equal((await a('POST', '/study/chat', { content: 'again', version: 1 })).status, 409);
  assert.equal(ai.requests.length, before);

  // AI failure or junk: 502, the conversation and the state are unchanged.
  nextReply = () => ({ status: 500, body: { error: { message: 'down' } } });
  assert.equal((await a('POST', '/study/chat', { content: 'hello?', version: 3 })).status, 502);
  nextReply = () => chatReply('not json at all');
  assert.equal((await a('POST', '/study/chat', { content: 'hello?', version: 3 })).status, 502);
  chat = await a('GET', '/study/chat');
  assert.equal(chat.body.version, 3);
  assert.equal(chat.body.messages.length, 6);
  assert.equal((await a('GET', '/study/state')).body.version, 2);

  // Isolation: user_b sees no conversation and cannot act on user_a's courses.
  assert.deepEqual((await b('GET', '/study/chat')).body, { messages: [], version: 0, activeQuiz: null, activeDeck: null });
  nextReply = () => chatReply(JSON.stringify({ reply: 'Sure.', actions: [{ type: 'start_session', name: 'BIOL 114', topic: 'cells' }] }));
  chat = await b('POST', '/study/chat', { content: 'start BIOL 114', version: 0 });
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body.messages.at(-1).actions, []);
  assert.deepEqual((await b('GET', '/study/state')).body.state.courses, []);
});

// Question sets in the chat (SPEC §6 steps 4–7): practice vs exam feedback timing, resume,
// grading, result context for the coach, and "missed topics" retests.
// Each generated set gets fresh question texts (the server rejects prompts already used in the session).
let quizBatch = 0;
/** The option id with this text (options are shuffled since D-032, so position means nothing). */
const pickText = (q, text) => q.options.find((o) => o.text === text).id;
const quizReply = (count) => chatReply(JSON.stringify({
  questions: Array.from({ length: count }, (_, i) => ({
    prompt: `Set ${quizBatch} question ${i + 1}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answerIndex: i % 4, concept: `concept-${i % 3}`, explanation: `Because ${i}.`,
  })),
}));

test('home chat: practice and exam question sets', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Hey!', suggestions: [], actions: [] };
  let quizCount = 4;
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('Create exactly')) { quizBatch += 1; return quizReply(quizCount); }
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_q', { aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [{ id: 'm1', courseId: 'bio', name: 'Notes', text: 'Cells have membranes. Mitochondria make ATP.' }] });
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_q')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  // Without a kind, no set starts (the coach is told to ask first).
  coach = { reply: 'Practice or exam?', suggestions: ['Practice', 'Exam'], actions: [{ type: 'start_quiz', name: 'BIOL 114', topic: 'cells', count: 4 }] };
  let chat = await call('POST', '/study/chat', { content: 'quiz me on cells', version: 0 });
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body.messages.at(-1).suggestions, ['Practice', 'Exam']);
  assert.deepEqual(chat.body.messages.at(-1).actions, []);
  assert.equal(chat.body.activeQuiz, null);

  // Practice set: 4 questions, session created with the check-in skipped, feedback per answer.
  coach = { reply: 'First question coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  chat = await call('POST', '/study/chat', { content: 'practice', version: 1 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const started = chat.body.messages.at(-1).actions[0];
  assert.equal(started.type, 'start_quiz');
  assert.equal(started.kind, 'practice');
  assert.equal(started.count, 4);
  assert.deepEqual(chat.body.activeQuiz, { sessionId: started.sessionId, courseId: 'bio', topic: 'cells', kind: 'practice', answered: 0, total: 4 });
  let session = (await call('GET', `/study/sessions/${started.sessionId}`)).body;
  assert.equal(session.checkIn.skipped, true);
  assert.equal(session.quiz.kind, 'practice');
  assert.equal(session.quiz.questions.length, 4);
  assert.equal(session.quiz.questions[0].feedback, undefined, 'no feedback before answering');
  assert.equal(session.quiz.questions[0].correctOptionId, undefined, 'correct answers never exposed');
  const q0 = session.quiz.questions[0];
  // Options are shuffled (D-032), so answers are picked by text: the key for question i is the letter at i % 4.
  session = (await call('PUT', `/study/sessions/${started.sessionId}/answers`, { questionId: q0.id, optionId: pickText(q0, 'B0'), assisted: false })).body;
  assert.equal(session.quiz.questions[0].feedback.correctOptionText, 'A0', 'practice: feedback right after answering');
  assert.equal(session.quiz.questions[0].feedback.selectedOptionText, 'B0');
  assert.equal(session.quiz.questions[1].feedback, undefined);
  // Resume: the chat reports progress; the coach is told a set is in progress.
  chat = await call('GET', '/study/chat');
  assert.equal(chat.body.activeQuiz.answered, 1);
  coach = { reply: 'Finish the set first.', suggestions: [], actions: [] };
  chat = await call('POST', '/study/chat', { content: 'what is ATP?', version: 2 });
  assert.match(ai.requests.at(-1).body.messages[0].content, /in progress: 1 of 4 answered/);
  // Answer the rest (q1 right, q2 wrong, q3 right) and grade through the session route.
  const answers = [[1, 'B1'], [2, 'A2'], [3, 'D3']];
  for (const [i, pick] of answers) {
    const q = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${started.sessionId}/answers`, { questionId: q.id, optionId: pickText(q, pick), assisted: false })).body;
  }
  session = (await call('POST', `/study/sessions/${started.sessionId}/grade`)).body;
  assert.equal(session.quiz.grade.correct, 2);
  assert.equal(session.quiz.grade.answered, 4);
  // After grading: the chat has no active quiz; the coach sees the result and the misses.
  chat = await call('GET', '/study/chat');
  assert.equal(chat.body.activeQuiz, null);
  coach = { reply: '2 of 4. Want tricks?', suggestions: ['Memory tricks for the misses', 'Another set on everything', 'Another set on the missed topics'], actions: [] };
  chat = await call('POST', '/study/chat', { content: 'I finished the set.', version: 3 });
  const system = ai.requests.at(-1).body.messages[0].content;
  assert.match(system, /Latest graded set: practice on BIOL 114 \/ cells: 2 of 4 correct \(50%\)/);
  assert.match(system, /\[concept-0\] Q: Set 1 question 1\? \| chose: B0 \| correct: A0/);
  assert.match(system, /\[concept-2\] Q: Set 1 question 3\? \| chose: A2 \| correct: C2/);

  // "Missed topics" set: exam kind, targeted on the missed concepts, plus up to 2 earlier correct questions.
  quizCount = 3;
  coach = { reply: 'Here comes a set on what you missed.', suggestions: [], actions: [{ type: 'start_quiz', name: 'BIOL 114', topic: 'cells', count: 3, kind: 'exam', scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'Another set on the missed topics', version: 4 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const retest = chat.body.messages.at(-1).actions[0];
  assert.equal(retest.kind, 'exam');
  assert.equal(retest.count, 5, '3 new + 2 earlier correct questions');
  const quizPrompt = ai.requests.filter((r) => r.body.messages[0].content.startsWith('Create exactly')).at(-1).body.messages[0].content;
  assert.match(quizPrompt, /Specifically test missed concepts: concept-0, concept-2/);
  session = (await call('GET', `/study/sessions/${retest.sessionId}`)).body;
  assert.equal(session.quiz.kind, 'exam');
  assert.equal(session.quiz.mode, 'targeted');
  assert.equal(session.quiz.questions.length, 5);
  const e0 = session.quiz.questions[0];
  session = (await call('PUT', `/study/sessions/${retest.sessionId}/answers`, { questionId: e0.id, optionId: e0.options[0].id, assisted: false })).body;
  assert.equal(session.quiz.questions[0].feedback, undefined, 'exam: no feedback until graded');

  // Quiz generation failure: nothing is saved, the student can retry.
  quizCount = 0;
  coach = { reply: 'Here comes a set.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 5, kind: 'practice', scope: 'all' }] };
  chat = await call('POST', '/study/chat', { content: 'Another set on everything', version: 5 });
  assert.equal(chat.status, 502);
  chat = await call('GET', '/study/chat');
  assert.equal(chat.body.version, 5);
  assert.equal(chat.body.messages.length, 10);
});

// Opening the app starts a new session with an app-written greeting (no AI) when the
// student has been away longer than the session gap.
test('home chat: session greeting on open', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Hey!', suggestions: [], actions: [] };
  const ai = await startAiStub(t, () => chatReply(JSON.stringify(coach)));
  // Gap of 0 minutes so the test does not have to wait.
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, HOME_CHAT_SESSION_GAP_MINUTES: '0' });
  await seedAccount(database.db, 'user_g', { aiConsent: true, courses: [{ id: 'bio', name: 'Bio 101' }], materials: [] });
  await seedAccount(database.db, 'user_empty', { aiConsent: true, courses: [], materials: [] });
  const call = async (user, method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(user)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  // No conversation yet: nothing is written (the client shows the first-visit greeting).
  let chat = await call('user_g', 'POST', '/study/chat/open');
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body, { messages: [], version: 0, activeQuiz: null, activeDeck: null });

  // After a conversation, opening appends one greeting with chips, and not twice in a row.
  coach = { reply: 'Added Bio 101. Questions or material?', suggestions: ['Quick set of questions'], actions: [] };
  await call('user_g', 'POST', '/study/chat', { content: 'hi', version: 0 });
  chat = await call('user_g', 'POST', '/study/chat/open');
  assert.equal(chat.body.messages.length, 3);
  const greeting = chat.body.messages.at(-1);
  assert.equal(greeting.role, 'assistant');
  assert.equal(greeting.sessionStart, true);
  assert.match(greeting.content, /Welcome back\. Continue with Bio 101\?/);
  assert.deepEqual(greeting.suggestions, ['Quick set of questions', 'Add material']);
  assert.equal(chat.body.version, 2);
  chat = await call('user_g', 'POST', '/study/chat/open');
  assert.equal(chat.body.messages.length, 3, 'no second greeting while the greeting is the last message');
  assert.equal(ai.requests.length, 1, 'greetings cost no AI call');

  // An account with no courses never gets a greeting.
  await seedAccount(database.db, 'user_nochat', { aiConsent: true, courses: [{ id: 'x', name: 'X' }], materials: [] });
  assert.deepEqual((await call('user_empty', 'POST', '/study/chat/open')).body.messages, []);
});

// "The misses" belong to a course (Dan, 2026-10-08: a Bio card turned up in an AB731 deck).
// A deck or retest "for the misses" on another course ignores the earlier set.
test('home chat: misses from another course are not used for a deck or a retest', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  let quizBatch = 0;
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('Create exactly') && system.includes('flashcards')) return deckReply(3);
    if (system.startsWith('Create exactly')) { quizBatch += 1; return quizReply(4); }
    if (system.startsWith('You check the answer key')) return chatReply(JSON.stringify({ checks: [] }));
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_x', { aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }, { id: 'ab731', name: 'AB731', kind: 'exam' }], materials: [] });
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_x')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const lastRequest = (startsWith) => ai.requests.filter((r) => r.body.messages[0].content.startsWith(startsWith)).at(-1).body;

  // A graded Bio set with two misses (q0, q2).
  let chat = await call('POST', '/study/chat', { content: 'practice', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const bioSet = chat.body.messages.at(-1).actions[0];
  let session = (await call('GET', `/study/sessions/${bioSet.sessionId}`)).body;
  for (const [i, pick] of [[0, 'B0'], [1, 'B1'], [2, 'A2'], [3, 'D3']]) {
    const q = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${bioSet.sessionId}/answers`, { questionId: q.id, optionId: pickText(q, pick), assisted: false })).body;
  }
  assert.equal((await call('POST', `/study/sessions/${bioSet.sessionId}/grade`)).body.quiz.grade.correct, 2);

  // Same course: the misses drive the deck.
  coach = { reply: 'Cards for the misses.', suggestions: [], actions: [{ type: 'start_flashcards', name: 'BIOL 114', topic: 'cells', count: 3, scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'Flashcards for the misses', version: 1 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.activeDeck.courseId, 'bio');
  assert.match(lastRequest('Create exactly').messages[0].content, /Build the deck around these missed items[\s\S]*concept-0[\s\S]*concept-2/);

  // Another course: the Bio misses are not a source; the deck is a plain topic deck on AB731.
  coach = { reply: 'Cards.', suggestions: [], actions: [{ type: 'start_flashcards', name: 'AB731', topic: 'Azure identity', count: 3, scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'Flashcards for the misses', version: 2 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.activeDeck.courseId, 'ab731');
  const deckPrompt = lastRequest('Create exactly').messages[0].content;
  assert.doesNotMatch(deckPrompt, /missed items|concept-0|concept-2/);
  assert.match(deckPrompt, /key terms, definitions, mechanisms and contrasts/);

  // Another course, retest "on the missed topics": a fresh diagnostic set on AB731, no Bio concepts.
  coach = { reply: 'Set.', suggestions: [], actions: [{ type: 'start_quiz', name: 'AB731', topic: 'Azure identity', count: 4, kind: 'practice', scope: 'missed' }] };
  chat = await call('POST', '/study/chat', { content: 'Another set on the missed topics', version: 3 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const abSet = chat.body.messages.at(-1).actions[0];
  assert.equal(abSet.courseId, 'ab731');
  assert.match(lastRequest('Create exactly').messages[0].content, /Specifically test missed concepts: the topic's concepts/);
  session = (await call('GET', `/study/sessions/${abSet.sessionId}`)).body;
  assert.equal(session.quiz.mode, 'diagnostic');
  assert.equal(session.quiz.questions.length, 4, 'no earlier-set questions carried over');
});

// Flashcards in the chat (D-021): a deck is a study session; got/again per card; finishing
// the deck schedules review items; the coach sees the deck's progress and result.
const deckReply = (count) => chatReply(JSON.stringify({
  cards: Array.from({ length: count }, (_, i) => ({ front: `Term ${i + 1}?`, back: `Meaning ${i + 1}.`, concept: `concept-${i % 2}` })),
}));

test('home chat: flashcard decks', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Here come your cards.', suggestions: [], actions: [{ type: 'start_flashcards', name: 'bio', topic: 'cells', count: 3 }] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    return system.startsWith('Create exactly') && system.includes('flashcards') ? deckReply(3) : chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_f', { aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] });
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_f')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  let chat = await call('POST', '/study/chat', { content: 'flashcards on cells', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const started = chat.body.messages.at(-1).actions[0];
  assert.equal(started.type, 'start_flashcards');
  assert.equal(started.count, 3);
  assert.deepEqual(chat.body.activeDeck, { sessionId: started.sessionId, courseId: 'bio', topic: 'cells', done: 0, total: 3 });
  assert.equal(chat.body.activeQuiz, null);

  let session = (await call('GET', `/study/sessions/${started.sessionId}`)).body;
  assert.equal(session.flashcards.cards.length, 3);
  assert.equal(session.flashcards.completedAt, null);
  assert.equal(session.checkIn.skipped, true);
  const [c0, c1, c2] = session.flashcards.cards;

  // got, again, got → not finished (c1 still pending); the coach is told 2 of 3 done.
  assert.equal((await call('POST', `/study/sessions/${started.sessionId}/flashcards/${c0.id}/review`, { result: 'got' })).status, 200);
  assert.equal((await call('POST', `/study/sessions/${started.sessionId}/flashcards/${c1.id}/review`, { result: 'again' })).status, 200);
  session = (await call('POST', `/study/sessions/${started.sessionId}/flashcards/${c2.id}/review`, { result: 'got' })).body;
  assert.equal(session.flashcards.completedAt, null);
  chat = await call('GET', '/study/chat');
  assert.equal(chat.body.activeDeck.done, 2);
  coach = { reply: 'Keep going.', suggestions: [], actions: [] };
  await call('POST', '/study/chat', { content: 'what does mitochondria mean?', version: 1 });
  assert.match(ai.requests.at(-1).body.messages[0].content, /flashcard deck on BIOL 114 \/ cells is in progress: 2 of 3 cards done/);

  // Second pass on c1: got → finished; review items written (again => missed).
  session = (await call('POST', `/study/sessions/${started.sessionId}/flashcards/${c1.id}/review`, { result: 'got' })).body;
  assert.ok(session.flashcards.completedAt);
  assert.deepEqual(session.flashcards.cards.map((c) => c.results), [['got'], ['again', 'got'], ['got']]);
  const items = session.reviewSchedule.filter((r) => r.quizMode === 'flashcards');
  assert.equal(items.length, 3);
  assert.equal(items.filter((r) => r.result === 'missed').length, 1);
  const state = (await call('GET', '/study/state')).body.state;
  assert.equal(state.reviewSchedule.filter((r) => r.quizMode === 'flashcards').length, 3, 'review items reach the account schedule');
  // Finished: no active deck; the coach sees the result; a review after finishing is a no-op.
  chat = await call('GET', '/study/chat');
  assert.equal(chat.body.activeDeck, null);
  await call('POST', '/study/chat', { content: 'I finished the flashcards.', version: 2 });
  assert.match(ai.requests.at(-1).body.messages[0].content, /Latest finished deck: BIOL 114 \/ cells, 3 cards, 1 needed a second look \(concept-1\)/);
  session = (await call('POST', `/study/sessions/${started.sessionId}/flashcards/${c0.id}/review`, { result: 'again' })).body;
  assert.deepEqual(session.flashcards.cards[0].results, ['got']);
  // Bad input.
  assert.equal((await call('POST', `/study/sessions/${started.sessionId}/flashcards/${c0.id}/review`, { result: 'meh' })).status, 400);
  assert.equal((await call('POST', `/study/sessions/${started.sessionId}/flashcards/00000000-0000-4000-8000-000000000000/review`, { result: 'got' })).status, 404);
});

// Memory sheet (D-025, automatic since D-026): grading a set writes rows for the misses by
// itself (memory_sheet task, merged into state.memorySheet); a named idea can be added from
// the chat; "Quiz me from my memory sheet" uses the sheet as the only source material.
test('home chat: memory sheet fills itself from a graded set; a set from the sheet', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coach = { reply: 'Hey!', suggestions: [], actions: [] };
  let sheetReply = { rows: [
    { term: 'concept-0', trick: 'Zero is the hero: A comes first', whenYouSee: 'Set 1 question 1', think: 'A0' },
    { term: 'concept-2', trick: 'Two → C (third letter)', whenYouSee: 'Set 1 question 3', think: 'C2' },
  ] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('Create exactly')) { quizBatch += 1; return quizReply(4); }
    if (system.startsWith('You write rows for a student')) return sheetReply ? chatReply(JSON.stringify(sheetReply)) : { status: 500, body: { error: { message: 'stub' } } };
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_m', { aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [{ id: 'm1', courseId: 'bio', name: 'Notes', text: 'Cells have membranes. Mitochondria make ATP.' }] });
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_m')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const sheetRequests = () => ai.requests.filter((r) => r.body.messages[0].content.startsWith('You write rows'));
  const waitForRows = async (count) => {
    for (let i = 0; i < 100; i += 1) {
      const state = (await call('GET', '/study/state')).body.state;
      if ((state.memorySheet ?? []).length >= count) return state;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`memory sheet never reached ${count} rows`);
  };

  // A graded practice set with two misses (q0, q2): the rows appear on their own, no chat turn.
  coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  let chat = await call('POST', '/study/chat', { content: 'practice', version: 0 });
  const started = chat.body.messages.at(-1).actions[0];
  let session = (await call('GET', `/study/sessions/${started.sessionId}`)).body;
  for (const [i, pick] of [[0, 'B0'], [1, 'B1'], [2, 'A2'], [3, 'D3']]) {
    const q = session.quiz.questions[i];
    session = (await call('PUT', `/study/sessions/${started.sessionId}/answers`, { questionId: q.id, optionId: pickText(q, pick), assisted: false })).body;
  }
  const graded = await call('POST', `/study/sessions/${started.sessionId}/grade`);
  assert.equal(graded.status, 200);
  assert.equal(graded.body.quiz.grade.correct, 2);
  let state = await waitForRows(2);
  assert.deepEqual(state.memorySheet.map((r) => r.term), ['concept-0', 'concept-2']);
  assert.equal(state.memorySheet[0].courseId, 'bio');
  assert.equal(state.memorySheet[0].trick, 'Zero is the hero: A comes first');
  const sheetRequest = sheetRequests().at(-1).body;
  assert.match(sheetRequest.messages[0].content, /memory sheet for BIOL 114/);
  const items = JSON.parse(sheetRequest.messages[1].content).items;
  assert.deepEqual(items.map((i) => [i.kind, i.concept]), [['missed_question', 'concept-0'], ['missed_question', 'concept-2']]);
  assert.equal(items[0].correct, 'A0');
  // Grading again is idempotent: no second sheet request.
  await call('POST', `/study/sessions/${started.sessionId}/grade`);
  assert.equal(sheetRequests().length, 1);

  // The coach sees the row count; the finished-set turn carries no sheet action.
  coach = { reply: '2 of 4.', suggestions: ['Memory tricks for the misses'], actions: [] };
  chat = await call('POST', '/study/chat', { content: 'I finished the set.', version: 1 });
  assert.match(ai.requests.at(-1).body.messages[0].content, /memory sheet: 2 rows/);
  assert.deepEqual(chat.body.messages.at(-1).actions, []);

  // A student request adds a row from the chat (scope "all": no misses are sent).
  sheetReply = { rows: [{ term: 'Osmosis', trick: 'Water follows salt', whenYouSee: 'hypotonic', think: 'cell swells' }] };
  coach = { reply: 'Saved.', suggestions: [], actions: [{ type: 'update_memory_sheet', name: 'bio', scope: 'all', topic: 'osmosis' }] };
  chat = await call('POST', '/study/chat', { content: 'add osmosis to my memory sheet', version: 2 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.messages.at(-1).actions[0].rows[0].term, 'Osmosis');
  const requestItems = JSON.parse(sheetRequests().at(-1).body.messages[1].content).items;
  assert.deepEqual(requestItems, [{ kind: 'student_request', text: 'osmosis' }]);
  state = (await call('GET', '/study/state')).body.state;
  assert.equal(state.memorySheet.length, 3);

  // A repeat of a term already on the sheet: nothing written, no card.
  coach = { reply: 'Already there.', suggestions: [], actions: [{ type: 'update_memory_sheet', name: 'bio', scope: 'all', topic: 'osmosis' }] };
  chat = await call('POST', '/study/chat', { content: 'add osmosis', version: 3 });
  assert.deepEqual(chat.body.messages.at(-1).actions, []);

  // "Quiz me from my memory sheet": the set's source is the sheet, not the saved notes.
  coach = { reply: 'From your sheet.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'Memory sheet', count: 4, kind: 'practice', scope: 'all' }] };
  chat = await call('POST', '/study/chat', { content: 'Quiz me from my memory sheet', version: 4 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const quizPrompt = ai.requests.filter((r) => r.body.messages[0].content.startsWith('Create exactly')).at(-1).body.messages.map((m) => m.content).join('\n');
  assert.match(quizPrompt, /Zero is the hero/);
  assert.match(quizPrompt, /Osmosis: Water follows salt/);
  assert.doesNotMatch(quizPrompt, /Mitochondria make ATP/);

  // A sheet AI failure after grading changes nothing visible: the grade stands, the sheet is unchanged.
  sheetReply = null;
  const second = chat.body.messages.at(-1).actions[0];
  session = (await call('GET', `/study/sessions/${second.sessionId}`)).body;
  const q = session.quiz.questions[0];
  await call('PUT', `/study/sessions/${second.sessionId}/answers`, { questionId: q.id, optionId: q.options[1].id, assisted: false });
  assert.equal((await call('POST', `/study/sessions/${second.sessionId}/grade`)).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  state = (await call('GET', '/study/state')).body.state;
  assert.equal(state.memorySheet.length, 3);
});

// Answer-key check (D-027): after the writer's reply, the checker's verdicts are applied
// before the set is stored; a checker failure keeps the set as written.
test('home chat: answer-key check fixes a wrong key and drops an unclear question', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  const coach = { reply: 'Set coming.', suggestions: [], actions: [{ type: 'start_quiz', name: 'bio', topic: 'cells', count: 4, kind: 'practice', scope: 'all' }] };
  let check = { checks: [
    { index: 0, consistent: false, correctIndex: 2 },
    { index: 1, consistent: false, correctIndex: -1 },
    { index: 2, consistent: true, correctIndex: 2 },
    { index: 3, consistent: true, correctIndex: 3 },
  ] };
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('Create exactly')) { quizBatch += 1; return quizReply(4); }
    if (system.startsWith('You check the answer key')) return check ? chatReply(JSON.stringify(check)) : { status: 500, body: { error: { message: 'stub' } } };
    return chatReply(JSON.stringify(coach));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url });
  await seedAccount(database.db, 'user_k', { aiConsent: true, courses: [{ id: 'bio', name: 'BIOL 114' }], materials: [] });
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_k')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  let chat = await call('POST', '/study/chat', { content: 'practice', version: 0 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const started = chat.body.messages.at(-1).actions[0];
  assert.equal(started.count, 3, 'the unclear question is dropped');
  const checkRequest = ai.requests.filter((r) => r.body.messages[0].content.startsWith('You check the answer key')).at(-1).body;
  const sent = JSON.parse(checkRequest.messages[1].content).questions;
  assert.equal(sent.length, 4);
  assert.deepEqual(sent[0].options, ['A0', 'B0', 'C0', 'D0']);
  assert.equal(sent[0].answerIndex, 0);
  let session = (await call('GET', `/study/sessions/${started.sessionId}`)).body;
  assert.equal(session.quiz.invalidItemCount, 1);
  assert.deepEqual(session.quiz.questions.map((q) => q.prompt), [`Set ${quizBatch} question 1?`, `Set ${quizBatch} question 3?`, `Set ${quizBatch} question 4?`]);
  // Question 1's key was moved from A0 to C0 (what its explanation supports).
  const q0 = session.quiz.questions[0];
  session = (await call('PUT', `/study/sessions/${started.sessionId}/answers`, { questionId: q0.id, optionId: q0.options[2].id, assisted: false })).body;
  assert.equal(session.quiz.questions[0].feedback.correctOptionText, 'C0');

  // Checker failure: the set is stored as written.
  check = null;
  chat = await call('POST', '/study/chat', { content: 'another', version: 1 });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.messages.at(-1).actions[0].count, 4);
});
