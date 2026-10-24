// Progress bars (D-126): real fractions where the app knows them (questions written, bytes
// uploaded), an honest estimate elsewhere that slows down and never reaches 100% on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, materialWorkMs, timeLeftText, transcribeWorkMs, uploadThenWork, waitFor, writtenProgress } from './progress.ts';

test('estimate: 0 at the start, about 80% at the expected time, never 100%', () => {
  assert.equal(estimate(0, 10_000), 0);
  assert.ok(Math.abs(estimate(10_000, 10_000) - 0.8) < 0.01);
  assert.ok(estimate(60_000, 10_000) < 0.96);
  assert.ok(estimate(5_000, 10_000) < estimate(6_000, 10_000), 'always moving forward');
  assert.equal(estimate(5_000, 0), 0.95, 'no expected time: nearly full, never full');
});

test('uploadThenWork: the real upload fills the first part, the estimate the rest', () => {
  assert.equal(uploadThenWork(0, 0, 20_000), 0);
  assert.equal(uploadThenWork(0.5, 0, 20_000), 0.15);
  assert.equal(uploadThenWork(1, 0, 20_000), 0.3);
  assert.ok(uploadThenWork(1, 20_000, 20_000) > 0.85 && uploadThenWork(1, 20_000, 20_000) < 0.9);
  assert.ok(uploadThenWork(1, 10 ** 9, 20_000) < 1);
});

test('expected times grow with the work', () => {
  assert.ok(materialWorkMs({ kind: 'file', bytes: 5_000_000 }) > materialWorkMs({ kind: 'file', bytes: 50_000 }));
  assert.ok(materialWorkMs({ kind: 'file', bytes: 10 ** 9 }) <= 120_000, 'capped');
  assert.ok(materialWorkMs({ kind: 'photo', bytes: 0 }) > 0 && materialWorkMs({ kind: 'website', bytes: 0 }) > 0);
  assert.ok(transcribeWorkMs(3_000) > transcribeWorkMs(300));
});

test('timeLeftText: rough words, never a precise promise', () => {
  assert.equal(timeLeftText(0, 180_000), 'about 3 minutes left');
  assert.equal(timeLeftText(150_000, 180_000), 'under a minute left');
  assert.equal(timeLeftText(200_000, 180_000), 'almost done');
  assert.equal(timeLeftText(0, 70_000), 'about 1 minute left');
});

test('writtenProgress: the real count and percentage of questions written', () => {
  assert.deepEqual(writtenProgress(4, 10), { fraction: 0.4, label: 'Writing questions: 4 of 10 (40%)' });
  assert.deepEqual(writtenProgress(0, 0), { fraction: 0, label: 'Writing questions…' });
  assert.equal(writtenProgress(12, 10).fraction, 1);
});

test('D-191: flashcards get their own filling bar; sets keep theirs; a chat gets none', () => {
  assert.deepEqual(waitFor('Flashcards on all topics'), { label: 'Coach is making your flashcards…', expectedMs: 20_000 });
  assert.equal(waitFor('Make me a flash card deck on chapter 3')?.label, 'Coach is making your flashcards…');
  assert.equal(waitFor('Give me a practice set on all topics')?.label, 'Coach is writing the first questions…');
  assert.equal(waitFor('Timed exam: full')?.expectedMs, 15_000);
  assert.equal(waitFor('What is RBAC?'), null);
  assert.equal(waitFor(undefined), null);
});
