// D-216: the memory hack picture's place in the reply and its polling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PICTURE_POLL_MS, PICTURE_WAIT_MS, pictureRefetch, pictureSlot } from './memory-picture.ts';

const title = (text) => [{ text }];
test('pictureSlot: under the first paragraph of the Memory hack section', () => {
  assert.deepEqual(pictureSlot([{ title: null, items: [1, 2] }, { title: title('🧠 Memory hack'), items: [1, 2, 3] }]), { section: 1, after: 0 });
  assert.equal(pictureSlot([{ title: null, items: [1] }, { title: title('🧠 Memory hack'), items: [] }]), null, 'not until its first paragraph is there');
  assert.equal(pictureSlot([{ title: title('🔁 Your misses'), items: [1] }]), null);
  assert.deepEqual(pictureSlot([{ title: title('🔁 Your misses'), items: [1] }, { title: title('🧠 Memory hack'), items: [1] }]), { section: 1, after: 0 });
});

test('pictureRefetch: asks again while drawing, up to the wait', () => {
  assert.equal(pictureRefetch('drawing', 0, 10_000), PICTURE_POLL_MS);
  assert.equal(pictureRefetch('drawing', 0, PICTURE_WAIT_MS + 1), false);
  assert.equal(pictureRefetch('ready', 0, 10), false);
  assert.equal(pictureRefetch('none', 0, 10), false);
  assert.equal(pictureRefetch(undefined, 0, 10), false);
});
