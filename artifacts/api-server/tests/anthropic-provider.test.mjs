// Runs the built server with AI_PROVIDER=anthropic against a stub Claude API and checks
// request shape (model, effort, structured output, refusal fallback) and that routes
// parse Claude's responses. No real API key or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, startAiStub, startServer } from './helpers/server.mjs';

const message = (text, stopReason = 'end_turn') => ({
  status: 200,
  body: {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'stub',
    content: text === null ? [] : [{ type: 'text', text }],
    stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  },
});

const quizQuestion = (n) => ({
  prompt: `Question ${n}?`, options: ['A', 'B', 'C', 'D'], answerIndex: n % 4, concept: 'Cells', explanation: 'Because.',
  mnemonic: 'M', teaching: 'T', distractors: ['a', 'b', 'c', 'd'].map(() => ({ reason: 'r', errorType: 'knowledge' })), sourceRefs: [],
});

function respond(request) {
  const system = JSON.stringify(request.body?.system ?? '');
  if (system.includes('REFUSE-ME') || JSON.stringify(request.body?.messages).includes('REFUSE-ME')) return message(null, 'refusal');
  if (system.includes('syllabus reader')) return message(JSON.stringify({ topics: ['Cell membranes'], deadlines: [{ title: 'Midterm', date: '2026-10-15', kind: 'exam' }] }));
  if (system.includes('study planner')) return message(JSON.stringify({ days: [{ date: '2026-11-30', phase: 'Review', focus: 'Cells', task: 'Quiz' }] }));
  if (system.includes('rigorous, encouraging')) return message(JSON.stringify({ questions: Array.from({ length: 10 }, (_, i) => quizQuestion(i)) }));
  return { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'unexpected' } } };
}

test('coach routes run on Claude when AI_PROVIDER=anthropic', async (t) => {
  buildServer();
  const ai = await startAiStub(t, respond);
  const { base, signToken } = await startServer(t, ai.port, {
    AI_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'sk-ant-test-dummy',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.port}`,
  });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_claude')}` };
  const post = (route, body) => fetch(`${base}/api/coach/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });

  // Syllabus analysis: Sonnet 5.5, low effort, structured output, refusal fallback.
  let res = await post('analyze', { course: 'Bio', filename: 'syllabus.txt', text: 'Midterm exam on 2026-10-15.' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { topics: ['Cell membranes'], deadlines: [{ title: 'Midterm', date: '2026-10-15', kind: 'exam' }] });
  let sent = ai.requests.at(-1);
  assert.match(sent.path, /^\/v1\/messages/);
  assert.equal(sent.headers['x-api-key'], 'sk-ant-test-dummy');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model, 'claude-sonnet-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.effort, 'low');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.deepEqual(sent.body.output_config.format.schema.required, ['topics', 'deadlines']);
  assert.match(sent.body.system, /^You are a precise academic syllabus reader/);
  assert.equal(sent.body.messages.length, 1);
  assert.equal(sent.body.messages[0].role, 'user');
  assert.equal(sent.body.thinking, undefined);
  assert.equal(sent.body.temperature, undefined);

  // Exam plan: Haiku 4.5, no effort (unsupported on Haiku), no fallback beta.
  res = await post('plan', { course: 'Bio', examTitle: 'Midterm', examDate: '2026-12-01', topics: ['Cells'], materials: 'Cells.' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).days.length, 1);
  sent = ai.requests.at(-1);
  assert.equal(sent.body.model, 'claude-haiku-4-5');
  assert.equal(sent.body.output_config.effort, undefined);
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.equal(sent.body.fallbacks, undefined);
  assert.equal(sent.headers['anthropic-beta'], undefined);

  // Classic quiz: medium effort; the route's own validation still runs on the result.
  res = await post('quiz', { course: 'Bio', topic: 'Cells', count: 10, materials: 'Cells are units of life.' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).questions.length, 10);
  assert.equal(ai.requests.at(-1).body.output_config.effort, 'medium');

  // A declined request becomes the route's normal friendly error, not a crash.
  res = await post('analyze', { course: 'Bio', filename: 'x.txt', text: 'REFUSE-ME' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Could not analyze this material/);
});

test('per-task provider override keeps other tasks on OpenAI', async (t) => {
  buildServer();
  const ai = await startAiStub(t, (request) => (request.path.startsWith('/v1/messages')
    ? respond(request)
    : { status: 500, body: { error: { message: 'stub openai' } } }));
  const { base, signToken } = await startServer(t, ai.port, {
    AI_PROVIDER_SYLLABUS: 'anthropic',
    ANTHROPIC_API_KEY: 'sk-ant-test-dummy',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.port}`,
  });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_mixed')}` };
  const analyze = await fetch(`${base}/api/coach/analyze`, { method: 'POST', headers, body: JSON.stringify({ course: 'Bio', filename: 'a.txt', text: 'Notes.' }) });
  assert.equal(analyze.status, 200);
  assert.match(ai.requests.at(-1).path, /^\/v1\/messages/);
  const plan = await fetch(`${base}/api/coach/plan`, { method: 'POST', headers, body: JSON.stringify({ course: 'Bio', examTitle: 'M', examDate: '2026-12-01', topics: [], materials: 'x' }) });
  assert.equal(plan.status, 502);
  assert.equal(ai.requests.at(-1).path, '/chat/completions');
  assert.equal(ai.requests.at(-1).body.model, 'gpt-5.6-terra');
});
