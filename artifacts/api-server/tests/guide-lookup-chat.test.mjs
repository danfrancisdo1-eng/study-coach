// End-to-end (D-044): the coach asks for an exam-guide lookup from a course thread; the
// server looks it up, saves it (the course becomes an exam), asks the coach again with the
// sections in hand, and stores that follow-up reply with the lookup action on the message.
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
const guide = { found: true, examName: 'AI-103', examCode: 'AI-103', vendor: 'Microsoft', sections: [
  { name: 'Implement generative AI and agentic solutions', weight: 32 }, { name: 'Plan and manage an Azure AI solution', weight: 27 }, { name: 'Implement computer vision solutions', weight: 12 },
], sourceUrl: 'https://learn.microsoft.com/credentials/certifications/exams/ai-103', notes: '' };

test('lookup_exam_guide from a course thread: guide saved, course becomes an exam, follow-up reply carries the sections', async (t) => {
  buildServer();
  const database = await startDatabase(t);
  let coachCalls = 0;
  let guideReply = () => chatReply(JSON.stringify(guide));
  const ai = await startAiStub(t, (request) => {
    const system = request.body.messages[0].content;
    if (system.startsWith('You find the official exam guide')) return guideReply();
    coachCalls += 1;
    if (system.includes('was just looked up this turn')) {
      return chatReply(JSON.stringify({ reply: 'Here are the official AI-103 sections. Which one?', suggestions: ['Implement generative AI and agentic solutions · 32%', 'Plan and manage an Azure AI solution · 27%', 'Implement computer vision solutions · 12%', 'All topics'], actions: [{ type: 'start_quiz', name: 'Microsoft 103', topic: 'x', count: 5, kind: 'practice' }] }));
    }
    return chatReply(JSON.stringify({ reply: 'Looking up the official guide.', suggestions: [], actions: [{ type: 'lookup_exam_guide', name: 'Microsoft 103' }] }));
  });
  // The stub speaks OpenAI; the exam_guide task is Anthropic-only (web search), so it runs on the stub via the per-task provider override.
  const { base, signToken } = await startServer(t, ai.port, { DATABASE_URL: database.url, AI_PROVIDER_EXAM_GUIDE: 'openai', AI_ALLOW_SEARCHLESS_LOOKUP: '1' });
  await database.db.query('insert into study_states (id, owner_id, state) values ($1, $2, $3)', ['state-user_g', 'user_g', JSON.stringify({ aiConsent: true, courses: [{ id: 'ms103', name: 'Microsoft 103' }, { id: 'ab731', name: 'Microsoft AB731', kind: 'exam' }], materials: [] })]);
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_g')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const chat = await call('POST', '/study/chat', { content: 'Show me the topics on the exam and their weights', version: 0, courseId: 'ms103' });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(coachCalls, 2, 'the coach is asked twice: once to decide, once with the sections');
  const last = chat.body.messages.at(-1);
  assert.equal(last.content, 'Here are the official AI-103 sections. Which one?', 'the follow-up reply replaces the "looking it up" line');
  assert.deepEqual(last.suggestions, ['Implement generative AI and agentic solutions · 32%', 'Plan and manage an Azure AI solution · 27%', 'Implement computer vision solutions · 12%', 'All topics']);
  assert.deepEqual(last.actions, [{ type: 'lookup_exam_guide', courseId: 'ms103', found: true, sections: 3 }], 'the follow-up turn\'s own actions are not applied');
  assert.equal(chat.body.activeQuiz, null);
  // The second coach prompt listed the sections under the course and said the guide was just looked up.
  const secondSystem = ai.requests.filter((r) => r.body.messages[0].content.startsWith('You are the study coach')).at(-1).body.messages[0].content;
  assert.match(secondSystem, /Official exam guide sections: Implement generative AI and agentic solutions \(32%\)/);
  assert.match(secondSystem, /official exam guide for Microsoft 103 was just looked up this turn: found, 3 sections/);
  assert.match(secondSystem, /This conversation belongs to Microsoft 103/);
  // State: the guide is saved and the course is now a certification exam.
  const state = (await call('GET', '/study/state')).body.state;
  const course = state.courses.find((c) => c.id === 'ms103');
  assert.equal(course.kind, 'exam');
  assert.equal(course.examGuide.found, true);
  assert.equal(course.examGuide.sections.length, 3);

  // Lookup failure: the report says not found, the course stays a course, the coach still answers.
  guideReply = () => ({ status: 500, body: { error: { message: 'stub down' } } });
  await database.db.query(`update study_states set state = $1 where owner_id = 'user_g'`, [JSON.stringify({ aiConsent: true, courses: [{ id: 'ms103', name: 'Microsoft 103' }], materials: [] })]);
  const again = await call('POST', '/study/chat', { content: 'Topics and weights?', version: 1, courseId: 'ms103' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body.messages.at(-1).actions, [{ type: 'lookup_exam_guide', courseId: 'ms103', found: false, sections: 0 }]);
  assert.equal((await call('GET', '/study/state')).body.state.courses[0].kind, undefined, 'not marked as an exam when nothing was found');
});
