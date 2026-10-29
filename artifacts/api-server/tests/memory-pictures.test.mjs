// D-216: memory-hack pictures: the prompt, the settings, the cap, what the app is told, and which reply shows one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGE_MODEL, MAX_PICTURES, cleanDescription, imageSettings, pictureView, picturePrompt, picturesToDraw } from '../src/lib/memory-pictures.ts';
import { validateCards } from '../src/lib/memory-cards.ts';
import { lessonText, pictureFor } from '../src/lib/lesson.ts';
import { systemPrompt as coach, version as coachVersion } from '../src/prompts/coach.v41.ts';
import { systemPrompt as cards, version as cardsVersion } from '../src/prompts/memory-cards.v4.ts';
import { TASK_SCHEMAS } from '../src/ai/schemas.ts';

test('the image prompt is a fixed template around one clean sentence', () => {
  assert.equal(picturePrompt('Two cats side by side: one boxed, one coloured in.'),
    'A simple, friendly flat illustration on a plain light background: Two cats side by side: one boxed, one coloured in. No text, letters, numbers, labels, logos or watermarks. Safe for a 13-year-old.');
  assert.equal(cleanDescription('  a cat\n\nin a box  '), 'a cat in a box');
  assert.equal(cleanDescription('none'), '');
  assert.equal(cleanDescription(42), '');
  assert.ok(cleanDescription('word '.repeat(200)).length <= 400);
});

test('image settings: small landscape webp; the model comes from AI_IMAGE_MODEL', () => {
  assert.deepEqual(imageSettings({}), { model: DEFAULT_IMAGE_MODEL, size: '1536x1024', quality: 'low', outputFormat: 'webp', outputCompression: 60 });
  assert.equal(imageSettings({ AI_IMAGE_MODEL: ' my-image-model ' }).model, 'my-image-model');
});

test('at most two pictures per set: the first two cards that ask for one', () => {
  const misses = ['a', 'b', 'c'].map((id) => ({ question_id: id, concept: id, section: null, stem: 'Q', options: ['x', 'y'], correct_answer: 'x', user_answer: 'y', explanation: '', hook: '', prior_techniques: [] }));
  const raw = { set_note: 'ok', cards: misses.map((m) => ({ question_id: m.question_id, diagnosis: 'GAP', technique: 'visual_scene', headline: 'H', why_you_missed: 'w', correct_answer: 'x', memory_tool: 'tool', recall_cue: 'cue', visual_cue: '', lock_in: { prompt: 'p', answer: 'a' }, nudges: [], key_concern: '', picture: `scene ${m.question_id}` })) };
  const { cards: checked } = validateCards(raw, misses);
  assert.deepEqual(checked.map((c) => c.picture), ['scene a', 'scene b', null]);
  assert.equal(MAX_PICTURES, 2);
  assert.deepEqual(picturesToDraw(checked), [{ questionId: 'a', description: 'scene a' }, { questionId: 'b', description: 'scene b' }]);
});

test('pictureView: ready, drawing while it is made, none otherwise', () => {
  const gradedAt = '2026-10-29T10:00:00.000Z';
  const now = new Date('2026-10-29T10:01:00.000Z');
  const later = new Date('2026-10-29T11:00:00.000Z');
  const base = { quiz: { grade: { gradedAt } }, memoryCards: { gradedAt, status: 'ready', cards: [{ questionId: 'a', picture: 'scene' }, { questionId: 'b', picture: null }] } };
  assert.deepEqual(pictureView({ ...base, memoryPictures: { a: { status: 'ready', gradedAt, mimeType: 'image/webp', data: 'QUJD', at: gradedAt } } }, 'a', later), { status: 'ready', mimeType: 'image/webp', data: 'QUJD' });
  assert.deepEqual(pictureView({ ...base, memoryPictures: { a: { status: 'drawing', gradedAt, at: gradedAt } } }, 'a', now), { status: 'drawing' });
  assert.deepEqual(pictureView(base, 'a', now), { status: 'drawing' }, 'asked for, not started yet');
  assert.deepEqual(pictureView(base, 'a', later), { status: 'none' }, 'too late');
  assert.deepEqual(pictureView(base, 'b', now), { status: 'none' }, 'no picture for this card');
  assert.deepEqual(pictureView({ ...base, memoryPictures: { a: { status: 'failed', gradedAt, at: gradedAt } } }, 'a', now), { status: 'none' });
  assert.deepEqual(pictureView({ ...base, memoryPictures: { a: { status: 'ready', gradedAt: '2026-10-01T00:00:00.000Z', data: 'old', at: gradedAt } } }, 'a', later), { status: 'none' }, 'an older attempt');
  assert.deepEqual(pictureView({ quiz: null }, 'a', now), { status: 'none' });
});

test('the picture rides on the reply that first teaches a pictured miss, never on a re-explanation', () => {
  const order = ['a', 'b'];
  const planCards = [{ questionId: 'a', picture: 'scene' }, { questionId: 'b', picture: null }];
  assert.deepEqual(pictureFor('s1', order, 0, 1, planCards), { sessionId: 's1', questionId: 'a' });
  assert.equal(pictureFor('s1', order, 1, 1, planCards), null, 'not yet: same miss again');
  assert.equal(pictureFor('s1', order, 1, 2, planCards), null, 'no picture on miss 2');
  assert.equal(pictureFor('s1', order, 1, 0, planCards), null, 'wrap-up');
  assert.equal(pictureFor('s1', order, 0, 1, null), null, 'no cards yet');
  const text = lessonText({ previous: 0, misses: [{ number: 1, question: 'Q', chose: 'x', correct: 'y', explanation: 'e', hook: '', plan: { whyYouMissed: 'w', headline: 'h', memoryTool: 't', technique: 'Picture it', keyConcern: null, picture: 'Two cats.' } }] });
  assert.match(text, /a picture of this is shown under your Memory hack: Two cats\./);
});

test('coach.v41 and memory-cards.v4 say how pictures work', () => {
  assert.equal(coachVersion, 'coach.v41');
  const walk = coach({ today: '2026-10-29', courses: [], firstVisit: false, quiz: null, focusCourseId: null, lesson: { text: '1. Q', previous: 0, total: 1 } });
  assert.match(walk, /the Memory hack is "\*\*Picture it\.\*\*" and its first paragraph is that same scene/);
  assert.match(walk, /never "see the picture below"/);
  assert.equal(cardsVersion, 'memory-cards.v4');
  const p = cards({ courseName: 'AI-103', kind: 'exam', recentTechniques: [] });
  assert.match(p, /At most two cards in the whole set have a picture/);
  assert.match(p, /Never words, letters, numbers, labels/);
  assert.ok(Object.keys(TASK_SCHEMAS.memory_cards.properties.cards.items.properties).includes('picture'));
});
