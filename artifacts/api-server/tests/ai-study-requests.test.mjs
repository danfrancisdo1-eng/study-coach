// The study routes (photo OCR, tutoring, session quiz) need the database, so they can't
// run end-to-end here. Instead, rebuild each AI request with the new prompt files +
// task config + request builder, and compare it with the request the original inline
// code (read from the baseline commit) would have sent for the same inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as tutorPrompt from '../src/prompts/tutor.v1.ts';
import * as sessionQuizPrompt from '../src/prompts/session-quiz.v1.ts';
import * as imageOcrPrompt from '../src/prompts/image-ocr.v1.ts';
import { taskConfig } from '../src/ai/tasks.ts';
import { chatCompletionBody } from '../../../lib/integrations-openai-ai-server/src/body.ts';

const BASELINE = 'a9994c0';
const original = execFileSync('git', ['show', `${BASELINE}:artifacts/api-server/src/routes/study.ts`], { encoding: 'utf8' });

function templateContaining(needle) {
  const at = original.indexOf(needle);
  assert.ok(at > 0, `baseline prompt not found: ${needle}`);
  return original.slice(original.lastIndexOf('`', at) + 1, original.indexOf('`', at));
}
const evalTemplate = (template, names, values) => new Function(...names, `return \`${template}\`;`)(...values);

const env = {};
const status = { coverage: 'selected', selectedChunks: 2, availableChunks: 5, truncated: true };
const sourceText = '[SOURCE: Lecture 3]\nMembranes are bilayers.\n\n[SOURCE: Notes]\nOsmosis moves water.';

for (const quiz of [null, { grade: null }, { grade: { percent: 80 } }]) {
  test(`tutor request is unchanged (quiz: ${JSON.stringify(quiz)})`, () => {
    const session = { topic: 'Cell membranes', quiz };
    const history = [{ role: 'user', content: 'What is a membrane?' }, { role: 'assistant', content: 'A bilayer.' }];
    const expected = {
      model: 'gpt-5.6-terra',
      max_completion_tokens: 1800,
      messages: [
        { role: 'system', content: evalTemplate(templateContaining('You are a careful college study coach.'), ['session', 'status', 'sourceText'], [session, status, sourceText]) },
        ...history,
        { role: 'user', content: 'Explain osmosis' },
      ],
    };
    const actual = chatCompletionBody({
      ...taskConfig('tutor', env),
      system: tutorPrompt.systemPrompt({ topic: session.topic, quizInProgress: Boolean(session.quiz && !session.quiz.grade), status, sourceText }),
      messages: [...history, { role: 'user', content: 'Explain osmosis' }],
    });
    assert.deepEqual(actual, expected);
  });
}

test('tutor request with no source material is unchanged', () => {
  const session = { topic: 'Ethics', quiz: null };
  const none = { coverage: 'none', selectedChunks: 0, availableChunks: 0, truncated: false };
  const expected = evalTemplate(templateContaining('You are a careful college study coach.'), ['session', 'status', 'sourceText'], [session, none, '']);
  assert.equal(tutorPrompt.systemPrompt({ topic: 'Ethics', quizInProgress: false, status: none, sourceText: '' }), expected);
});

test('session quiz request is unchanged (diagnostic and targeted)', () => {
  for (const [expectedCount, originalPrompts, weakConcepts] of [[12, [], []], [6, ['What is a cell?', 'Define osmosis'], ['osmosis', 'diffusion']]]) {
    const userContent = JSON.stringify({ courseId: 'bio', topic: 'Cells', sourceMaterial: sourceText });
    const expected = {
      model: 'gpt-5.6-terra',
      max_completion_tokens: 6500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: evalTemplate(templateContaining('distinct, clear, single-answer college practice questions'), ['expectedCount', 'originalPrompts', 'weakConcepts', 'status'], [expectedCount, originalPrompts, weakConcepts, status]) },
        { role: 'user', content: userContent },
      ],
    };
    const actual = chatCompletionBody({
      ...taskConfig('session_quiz', env),
      system: sessionQuizPrompt.systemPrompt({ expectedCount, originalPrompts, weakConcepts, status }),
      messages: [{ role: 'user', content: userContent }],
    });
    assert.deepEqual(actual, expected);
  }
});

test('photo OCR request is unchanged', () => {
  const at = original.indexOf('Transcribe only the readable text');
  const originalSystem = original.slice(original.lastIndexOf("'", at) + 1, original.indexOf("'", at));
  const base64 = Buffer.from('fake image bytes').toString('base64');
  const expected = {
    model: 'gpt-5.4-mini',
    max_completion_tokens: 12000,
    messages: [
      { role: 'system', content: originalSystem },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' } }] },
    ],
    response_format: { type: 'json_object' },
  };
  const actual = chatCompletionBody({
    ...taskConfig('image_ocr', env),
    system: imageOcrPrompt.systemPrompt(),
    messages: [{ role: 'user', image: { mimeType: 'image/png', base64 } }],
  });
  assert.deepEqual(actual, expected);
});

test('model IDs can be overridden per task from configuration', () => {
  assert.equal(taskConfig('tutor', { AI_MODEL_TUTOR: 'some-other-model' }).model, 'some-other-model');
  assert.equal(taskConfig('tutor', { AI_MODEL_TUTOR: '  ' }).model, 'gpt-5.6-terra');
  assert.equal(taskConfig('image_ocr', { AI_MODEL_TUTOR: 'x' }).model, 'gpt-5.4-mini');
});

test('tutor.v2 is tutor.v1 plus only the D-008 homework rule', async () => {
  const v2 = await import('../src/prompts/tutor.v2.ts');
  const input = { topic: 'Cells', quizInProgress: true, status, sourceText };
  const rule = ' Outside an in-progress quiz in this app, help with anything the student asks, including homework and assignments: when they ask for an answer or a written response, give it completely and accurately, then make sure they understand it well enough to get it right on a test. Do not refuse, hold back, or lecture about academic integrity.';
  assert.equal(v2.version, 'tutor.v2');
  assert.equal(v2.systemPrompt(input).replace(rule, ''), tutorPrompt.systemPrompt(input));
});

test('tutor.v3 keeps every tutor.v2 rule and adds the short-answer rules (D-015)', async () => {
  const v2 = await import('../src/prompts/tutor.v2.ts');
  const v3 = await import('../src/prompts/tutor.v3.ts');
  assert.equal(v3.version, 'tutor.v3');
  for (const quizInProgress of [false, true]) {
    const input = { topic: 'Cells', quizInProgress, status, sourceText };
    const v2Text = v2.systemPrompt(input);
    const v3Text = v3.systemPrompt(input);
    // Every sentence of v2 survives in v3 (rules are only added, never dropped).
    for (const sentence of v2Text.split('Material:\n')[0].split('. ').map((s) => s.trim()).filter((s) => s.length > 20)) {
      assert.ok(v3Text.includes(sentence), `v3 dropped a v2 rule: ${sentence.slice(0, 60)}`);
    }
    assert.ok(v3Text.endsWith(`Material:\n${sourceText}`), 'v3 still ends with the material block');
  }
  const withMaterial = v3.systemPrompt({ topic: 'Cells', quizInProgress: false, status, sourceText });
  assert.match(withMaterial, /short/i, 'v3 asks for short answers');
  assert.match(withMaterial, /lecture|textbook-style/i, 'v3 forbids lecturing');
  assert.ok(!withMaterial.includes('much faster if you add your course material'), 'no upload flag when material is present');
});

test('tutor.v3 adds the add-your-material flag only when no material is saved', async () => {
  const v3 = await import('../src/prompts/tutor.v3.ts');
  const none = { coverage: 'none', selectedChunks: 0, availableChunks: 0, truncated: false };
  const text = v3.systemPrompt({ topic: 'Biology', quizInProgress: false, status: none, sourceText: '' });
  assert.ok(text.includes("You'll learn what's on your exam much faster if you add your course material."), 'flag present');
  assert.ok(text.endsWith('Material:\n(No source material selected.)'));
});
