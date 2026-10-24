// D-185: big uploads are split at chapters, then sections, then paragraphs, never inside a word,
// and nothing is lost: the parts joined back together are the original text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { MAX_SPLIT_UPLOAD_CHARS, UPLOAD_PART_CHARS, partName, splitUpload } from '../src/lib/split-upload.ts';

const chapter = (n, size) => `# Chapter ${n} — Topic ${n}\n\n## Key takeaways\n\n${'- A fact about this chapter that the student should know.\n'.repeat(Math.ceil(size / 58))}`;
const joined = (parts) => parts.map((p) => p.text).join('');
const squash = (s) => s.replace(/\s+/g, '');

test('a text that fits is one part, unchanged', () => {
  const parts = splitUpload('# Notes\n\nShort file.');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, '# Notes\n\nShort file.');
  assert.equal(parts[0].firstHeading, 'Notes');
});

test('a 200,000-character packet becomes 3 parts cut at chapter headings, nothing lost', () => {
  const text = Array.from({ length: 26 }, (_, i) => chapter(i + 1, 7600)).join('\n');
  assert.ok(text.length > 190_000 && text.length < 210_000);
  const parts = splitUpload(text);
  assert.equal(parts.length, 3);
  for (const p of parts) {
    assert.ok(p.text.length <= UPLOAD_PART_CHARS, `part ${p.index} is ${p.text.length}`);
    assert.match(p.text, /^# Chapter \d+/, 'each part starts on a chapter heading');
  }
  assert.equal(parts[0].firstHeading, 'Chapter 1 — Topic 1');
  assert.equal(parts[2].lastHeading, 'Chapter 26 — Topic 26');
  assert.equal(squash(joined(parts)), squash(text));
});

test('a plain file without headings is cut between paragraphs, then sentences, never inside a word', () => {
  const para = 'This sentence explains a concept in plain words. '.repeat(40);
  const text = Array.from({ length: 120 }, () => para).join('\n\n');
  const parts = splitUpload(text);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(p.text.length <= UPLOAD_PART_CHARS);
  for (const p of parts.slice(0, -1)) assert.match(p.text, /[.!?]$/, 'ends on a sentence');
  assert.equal(squash(joined(parts)), squash(text));
});

test('PDF-style chapter lines ("Chapter 3 ...", "Unit 4") count as chapter breaks', () => {
  const text = [1, 2, 3].map((n) => `Chapter ${n} The topic\n${'Body text sentence here. '.repeat(2000)}`).join('\n');
  const parts = splitUpload(text, 60_000);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.firstHeading), ['Chapter 1 The topic', 'Chapter 2 The topic', 'Chapter 3 The topic']);
});

test('one unbroken run is cut at a space', () => {
  const text = 'word '.repeat(30_000).trim();
  const parts = splitUpload(text, 50_000);
  for (const p of parts) { assert.ok(p.text.length <= 50_000); assert.ok(p.text.split(/\s+/).every((w) => w === 'word'), 'no word was cut'); }
  assert.equal(squash(joined(parts)), squash(text));
});

test('part names and the ceiling', () => {
  assert.equal(partName('AI-103 packet.md', 2, 3), 'AI-103 packet.md (part 2 of 3)');
  assert.equal(MAX_SPLIT_UPLOAD_CHARS, 400_000);
  assert.deepEqual(splitUpload('   '), []);
});

// Dan's real AI-103 packet (199,685 characters), when it is on this machine.
const packet = process.env.AI103_PACKET;
test('Dan\'s AI-103 packet splits at its chapters', { skip: !packet || !existsSync(packet) }, () => {
  const text = readFileSync(packet, 'utf8');
  const parts = splitUpload(text);
  assert.ok(parts.length >= 3 && parts.length <= 4, `${parts.length} parts`);
  for (const p of parts) assert.ok(p.text.length <= UPLOAD_PART_CHARS);
  assert.equal(squash(joined(parts)), squash(text.trim()));
  console.log(parts.map((p) => `part ${p.index}: ${p.text.length} chars, ${p.firstHeading} … ${p.lastHeading}`).join('\n'));
});
