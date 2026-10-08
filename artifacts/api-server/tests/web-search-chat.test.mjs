// End-to-end (D-045): the coach asks the app to search the web; the server runs the lookup,
// records a web_search action, asks the coach again with the findings, and stores that
// follow-up reply. A failed search still answers, with found=false on the action.
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

test('web_search from the chat: findings reach the follow-up turn, the action is recorded', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let lookupReply = () => chatReply('Microsoft Learn has a free practice assessment with sample questions.\nSources:\nhttps://learn.microsoft.com/credentials/certifications/exams/ab-731/practice/assessment');
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith("You answer a student's request using web search")) return lookupReply();
    if (system.includes('The app just searched the web for the student this turn')) {
      return chatReply(JSON.stringify({ reply: 'From the web: Microsoft Learn has a free practice assessment. https://learn.microsoft.com/credentials/certifications/exams/ab-731/practice/assessment', suggestions: ['Set in that format'], actions: [{ type: 'web_search', name: 'x', topic: 'again' }] }));
    }
    return chatReply(JSON.stringify({ reply: 'Searching the web for that.', suggestions: [], actions: [{ type: 'web_search', name: 'Microsoft AB731', topic: 'Microsoft AB731 exam sample questions' }] }));
  });
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, AI_PROVIDER_WEB_LOOKUP: 'openai', AI_ALLOW_SEARCHLESS_LOOKUP: '1' });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_w', 'user_w', JSON.stringify({ aiConsent: true, courses: [{ id: 'ab731', name: 'Microsoft AB731', kind: 'exam' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_w')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const chat = await call('POST', '/study/chat', { content: 'Search the internet for sample questions on the AB731 exam', version: 0, courseId: 'ab731' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const last = chat.body.messages.at(-1);
  assert.match(last.content, /^From the web: Microsoft Learn/);
  assert.deepEqual(last.suggestions, ['Set in that format']);
  assert.deepEqual(last.actions, [{ type: 'web_search', courseId: 'ab731', query: 'Microsoft AB731 exam sample questions', found: true }], 'the follow-up turn\'s own actions are not applied');
  const lookup = ai.requests.find((r) => r.body.messages[0].content.startsWith("You answer a student's request using web search"));
  assert.deepEqual(JSON.parse(lookup.body.messages[1].content), { request: 'Microsoft AB731 exam sample questions', course: 'Microsoft AB731' });
  const second = ai.requests.filter((r) => r.body.messages[0].content.startsWith('You are the study coach')).at(-1).body.messages[0].content;
  assert.match(second, /query: "Microsoft AB731 exam sample questions"/);
  assert.match(second, /free practice assessment/);

  // The search fails: the coach still answers (from the "nothing reliable" note) and the action says so.
  lookupReply = () => ({ status: 500, body: { error: { message: 'stub down' } } });
  const again = await call('POST', '/study/chat', { content: 'search again', version: 1, courseId: 'ab731' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body.messages.at(-1).actions, [{ type: 'web_search', courseId: 'ab731', query: 'Microsoft AB731 exam sample questions', found: false }]);
  const third = ai.requests.filter((r) => r.body.messages[0].content.startsWith('You are the study coach')).at(-1).body.messages[0].content;
  assert.match(third, /Nothing reliable was found/);
});
