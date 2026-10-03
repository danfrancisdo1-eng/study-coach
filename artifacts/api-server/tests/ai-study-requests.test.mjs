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
