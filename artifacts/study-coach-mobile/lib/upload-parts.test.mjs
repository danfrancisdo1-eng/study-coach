// D-185: a big file is saved in parts; when storage is full the parts that fit are kept and the rest are named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStorageFull, partRange, partsSavedLine } from './upload-parts.ts';

const part = (n, first, last) => ({ name: `AI-103.md (part ${n} of 3)`, text: 'x', characterCount: 1, firstHeading: first, lastHeading: last });
const parts = [
  part(1, 'Chapter 1 — Plan', 'Chapter 15 — Analyze text'),
  part(2, 'Chapter 16 — Text agent', 'Appendix A — Exam prep'),
  part(3, 'Appendix B — By domain', 'Appendix B — By domain'),
];

test('all parts saved', () => {
  assert.equal(partsSavedLine('AI-103.md', parts, 3), 'AI-103.md saved in 3 parts, split at its chapters. The coach writes notes for each part.');
});

test('some parts saved: says which were kept, which did not fit, and what to do', () => {
  assert.equal(partsSavedLine('AI-103.md', parts, 2),
    "Saved parts 1–2 of 3 (Chapter 1 — Plan to Appendix A — Exam prep). Part 3 (Appendix B — By domain) didn't fit: your account's storage is full. Delete an older upload in this course to make room, then add the file again.");
  assert.match(partsSavedLine('AI-103.md', parts, 1), /^Saved part 1 of 3 \(Chapter 1 — Plan to Chapter 15 — Analyze text\)\. Parts 2–3 \(Chapter 16 — Text agent to Appendix B — By domain\) didn't fit/);
});

test('nothing fits', () => {
  assert.match(partsSavedLine('AI-103.md', parts, 0), /^AI-103\.md wasn't saved: your account's storage is full\. Delete an older upload/);
});

test('ranges without headings and the storage-full check', () => {
  assert.equal(partRange([part(1, '', '')]), '');
  assert.equal(partRange([part(1, 'A', 'A')]), 'A');
  assert.equal(isStorageFull(new Error('Study state is too large.')), true);
  assert.equal(isStorageFull({ data: { error: 'Study state is too large.' } }), true);
  assert.equal(isStorageFull(new Error('Network request failed')), false);
});
