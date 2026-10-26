// D-206: the coach's reply text is pulled out of its JSON while the JSON streams in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyExtractor, sseEvent } from '../src/lib/reply-stream.ts';

const feed = (json, size) => {
  const x = new ReplyExtractor();
  const out = [];
  for (let i = 0; i < json.length; i += size) out.push(x.push(json.slice(i, i + size)));
  return out;
};

test('the reply comes out whole, whatever the chunk size, with escapes decoded', () => {
  const reply = 'Nice.\n\nThe answer was **"0, 2, 4, 6"** \\ done. Café 🎯 ok.';
  const json = JSON.stringify({ reply, suggestions: ['Got it', 'Not yet'], actions: [], teaching: 2 });
  const ascii = json.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  for (const size of [1, 2, 3, 5, 7, 64, 10_000]) {
    assert.equal(feed(json, size).join(''), reply, `raw, chunks of ${size}`);
    assert.equal(feed(ascii, size).join(''), reply, `escaped, chunks of ${size}`);
  }
});

test('nothing before the reply key, nothing after its closing quote', () => {
  const x = new ReplyExtractor();
  assert.equal(x.push('{"rep'), '');
  assert.equal(x.push('ly": "Hel'), 'Hel');
  assert.equal(x.push('lo", "suggestions": ["a"'), 'lo');
  assert.equal(x.push(', "reply": "again"}'), '');
});

test('sseEvent writes one server-sent event', () => {
  assert.equal(sseEvent('delta', { text: 'a\nb' }), 'event: delta\ndata: {"text":"a\\nb"}\n\n');
});
