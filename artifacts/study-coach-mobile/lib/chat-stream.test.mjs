import test from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_TITLE_MS, BEFORE_TITLE_MS, SseParser, WORD_MS, paceStep, pinnedOffset, streamable } from './chat-stream.ts';

test('400 words a minute is 150 ms a word', () => assert.equal(WORD_MS, 150));

test('SseParser: events across chunk boundaries, CRLF too; a broken event is skipped', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('event: delta\ndata: {"te'), []);
  assert.deepEqual(p.push('xt":"Hi"}\n\nevent: delta\r\ndata: {"text":" there"}\r\n\r\nevent: done\ndata: {"ver'), [
    { event: 'delta', data: { text: 'Hi' } }, { event: 'delta', data: { text: ' there' } },
  ]);
  assert.deepEqual(p.push('sion":2}\n\nevent: x\ndata: {nope\n\n'), [{ event: 'done', data: { version: 2 } }]);
});

/** Plays the pacer to the end over the whole text, returning each piece shown and its delay. */
const play = (text) => {
  const steps = [];
  let shown = 0;
  for (let step = paceStep(text, shown, true); step; step = paceStep(text, shown, true)) {
    steps.push([text.slice(shown, step.shown), step.delay]);
    shown = step.shown;
  }
  return steps;
};

test('paceStep: a title line at once, a pause after it, then word by word; a pause before the next title', () => {
  const text = "### 🎯 Coach's evaluation\n- **7 of 10.** Solid.\n### 📈 Exam readiness\n> Close.";
  assert.deepEqual(play(text), [
    ["### 🎯 Coach's evaluation\n", 0],
    ['-', AFTER_TITLE_MS],
    [' **7', WORD_MS], [' of', WORD_MS], [' 10.**', WORD_MS], [' Solid.', WORD_MS],
    ['\n### 📈 Exam readiness\n', BEFORE_TITLE_MS],
    ['>', AFTER_TITLE_MS], [' Close.', WORD_MS],
  ]);
});

test('paceStep: waits for a word or title line that may still be growing, unless the reply is finished', () => {
  assert.equal(paceStep('Hel', 0, false), null);
  assert.deepEqual(paceStep('Hello there', 0, false), { shown: 5, delay: 0 });
  assert.equal(paceStep('Hello there', 5, false), null);
  assert.deepEqual(paceStep('Hello there', 5, true), { shown: 11, delay: WORD_MS });
  assert.equal(paceStep('### 🔁 Your mis', 0, false), null);
  assert.equal(paceStep('Hi', 2, true), null);
  assert.deepEqual(paceStep('Hi\n\n', 2, true), { shown: 4, delay: 0 });
});

test('streamable: the report card, the walk start and replies while the walk is on', () => {
  assert.equal(streamable('I finished the set.', undefined), true);
  assert.equal(streamable('Go over my misses', undefined), true);
  assert.equal(streamable('yes', { role: 'assistant', suggestions: ['Got it', 'Not yet'] }), true);
  assert.equal(streamable('Quiz me', { role: 'assistant', suggestions: ['Practice', 'Exam'] }), false);
  assert.equal(streamable('hi', undefined), false);
});

test('pinnedOffset: at the bottom while it fits, then the top stays at the top', () => {
  assert.equal(pinnedOffset(300, 600), 0);
  assert.equal(pinnedOffset(900, 600), 300);
  assert.equal(pinnedOffset(900, 0), 0);
});

test('closeOpenBold: a bold opened mid-stream is closed on its line', async () => {
  const { closeOpenBold } = await import('./chat-stream.ts');
  assert.equal(closeOpenBold('The answer was **0, 2'), 'The answer was **0, 2**');
  assert.equal(closeOpenBold('**Done.** ok\nnext **a'), '**Done.** ok\nnext **a**');
  assert.equal(closeOpenBold('plain'), 'plain');
});

test('D-208: a dropped stream is sent once more; a 409 then means the first got through', async () => {
  const { AlreadySent, isNetworkFailure, sendWithRetry } = await import('./chat-stream.ts');
  const noWait = async () => {};
  assert.equal(isNetworkFailure(new TypeError('Network request failed')), true);
  assert.equal(isNetworkFailure({ status: 0 }), true);
  assert.equal(isNetworkFailure({ status: 502 }), false);

  let calls = 0; let cleared = 0;
  const ok = await sendWithRetry(async () => { calls += 1; if (calls === 1) throw new Error('fetch failed: lost'); return 'chat'; }, () => { cleared += 1; }, noWait);
  assert.deepEqual([ok, calls, cleared], ['chat', 2, 1], 'one retry, the first try cleared');

  calls = 0;
  await assert.rejects(sendWithRetry(async () => { calls += 1; throw { status: 429 }; }, () => {}, noWait), (e) => e.status === 429);
  assert.equal(calls, 1, 'an answer from the server (limit, error) is not retried');

  calls = 0;
  await assert.rejects(sendWithRetry(async () => { calls += 1; throw calls === 1 ? { status: 0 } : { status: 409 }; }, () => {}, noWait), (e) => e instanceof AlreadySent);

  calls = 0;
  await assert.rejects(sendWithRetry(async () => { calls += 1; throw new TypeError('x'); }, () => {}, noWait), (e) => e instanceof TypeError);
  assert.equal(calls, 2, 'never more than one retry');
});
