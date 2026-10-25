// D-194: memory cards: which misses get cards, what the memory coach is told, and the checks on
// its reply (the key wins, nothing gives the answer away, at most 5 cards, 3 nudges).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  missesOf, pickTopMisses, techniqueHistory, missInput, notesExcerpt, validateCards, revealsAnswer, memoryCardsView, MAX_CARDS, WRITING_WINDOW_MS,
} from '../src/lib/memory-cards.ts';

const q = (id, concept, { right = false, answered = true, flag, invalid } = {}) => ({
  id, prompt: `Which one is ${concept}?`, concept, explanation: `Because ${concept}.`, hook: '',
  options: [{ id: `${id}a`, text: `${concept} answer` }, { id: `${id}b`, text: 'Wrong pick' }, { id: `${id}c`, text: 'Other' }, { id: `${id}d`, text: 'Last' }],
  correctOptionId: `${id}a`,
  answers: answered ? [{ optionId: right ? `${id}a` : `${id}b`, assisted: false }] : [],
  ...(flag ? { flag } : {}), ...(invalid ? { invalid } : {}),
});

test('missesOf keeps answered wrong questions that count; a report whose re-check upheld the key still counts', () => {
  const qs = [
    q('1', 'Osmosis'), q('2', 'Diffusion', { right: true }), q('3', 'Mitosis', { answered: false }),
    q('4', 'Meiosis', { flag: { kind: 'wrong_answer', reportedAt: '' } }),
    q('5', 'ATP', { flag: { kind: 'wrong_answer', reportedAt: '', recheck: { verdict: 'key_holds', explanation: '', checkedAt: '' } } }),
    q('6', 'Ribosome', { invalid: true }),
  ];
  assert.deepEqual(missesOf(qs).map((x) => x.id), ['1', '5']);
});

test('pickTopMisses: concepts missed before first, then the heavier section, then set order; at most 5', () => {
  const sections = [{ name: 'Agents', weight: 25 }, { name: 'Generative AI', weight: 30 }];
  const misses = [q('1', 'Agents: tools'), q('2', 'Generative AI: tokens'), q('3', 'Agents: memory'), q('4', 'Other'), q('5', 'Generative AI: RAG'), q('6', 'Agents: plans'), q('7', 'Last')];
  const before = new Map([['agents: memory', 2]]);
  const top = pickTopMisses(misses, before, sections);
  assert.equal(top.length, MAX_CARDS);
  assert.deepEqual(top.map((x) => x.id), ['3', '2', '5', '1', '6']);
});

test('techniqueHistory: per concept (any past ready set) and the last two sets overall; this session excluded', () => {
  const rec = (gradedAt, cards) => ({ gradedAt, status: 'ready', setNote: '', cards, version: 'v1', updatedAt: gradedAt });
  const card = (concept, technique) => ({ concept, technique });
  const sessions = [
    { id: 'now', memoryCards: rec('2026-10-05', [card('X', 'analogy')]) },
    { id: 's1', memoryCards: rec('2026-10-01', [card('Osmosis', 'contrast_pair')]) },
    { id: 's2', memoryCards: rec('2026-10-03', [card('osmosis ', 'story_chain'), card('ATP', 'why_chain')]) },
    { id: 's3', memoryCards: rec('2026-10-04', [card('Krebs', 'mini_palace')]) },
    { id: 's4', memoryCards: { ...rec('2026-10-04', [card('Krebs', 'trap_flag')]), status: 'failed' } },
  ];
  const { byConcept, recent } = techniqueHistory(sessions, 'now');
  assert.deepEqual(byConcept.get('osmosis'), ['story_chain', 'contrast_pair']);
  assert.deepEqual(recent, ['mini_palace', 'story_chain', 'why_chain']);
  assert.equal(byConcept.has('x'), false);
});

test('missInput: the stem, options, right and chosen answers, section and prior techniques', () => {
  const m = missInput(q('1', 'Agents: tools'), [{ name: 'Agents', weight: 25 }], ['analogy', 'analogy']);
  assert.equal(m.question_id, '1');
  assert.equal(m.correct_answer, 'Agents: tools answer');
  assert.equal(m.user_answer, 'Wrong pick');
  assert.equal(m.section, 'Agents');
  assert.deepEqual(m.options.length, 4);
  assert.deepEqual(m.prior_techniques, ['analogy']);
});

test('notesExcerpt keeps only paragraphs that share a word with the misses, within the limit', () => {
  const misses = [missInput(q('1', 'Osmosis'), [], [])];
  const notes = ['## Cells\n\nOsmosis moves water across a membrane.\n\nThe Krebs cycle makes NADH.', 'More osmosis: hypotonic swells.'];
  assert.equal(notesExcerpt(notes, misses), 'Osmosis moves water across a membrane.\n\nMore osmosis: hypotonic swells.');
  assert.equal(notesExcerpt(notes, misses, 20), '');
});

test('revealsAnswer finds the whole answer as words; short answers are not checked', () => {
  assert.equal(revealsAnswer('Is it Cloud Armor?', 'Cloud Armor'), true);
  assert.equal(revealsAnswer('Door guard vs brain guard', 'Cloud Armor'), false);
  assert.equal(revealsAnswer('Is it B?', 'B'), false);
});

test('validateCards: the key wins, unknown ids and empty cards drop, cues and nudges that give the answer away are removed', () => {
  const misses = [missInput(q('1', 'Cloud Armor'), [], []), missInput(q('2', 'Model Armor'), [], [])];
  const raw = {
    set_note: '  Solid on security basics.  ',
    cards: [
      { question_id: 'nope', headline: 'x', memory_tool: 'y' },
      {
        question_id: '1', diagnosis: 'CONFUSION', technique: 'contrast_pair', headline: 'Cloud guards the door',
        why_you_missed: 'Both have Armor in the name.', correct_answer: 'Something else the model made up',
        memory_tool: 'CLOUD Armor stands at the network door; MODEL Armor guards the AI brain.',
        recall_cue: 'Cloud Armor answer', visual_cue: '', lock_in: { prompt: 'Which one stops a DDoS?', answer: 'Cloud Armor' },
        nudges: ['Which Armor stands at the door?', 'Cloud Armor answer is it?', 'Not a question', 'x'.repeat(95) + '?', 'Door or brain?', 'Fourth one?'],
        key_concern: 'none',
      },
      { question_id: '1', headline: 'duplicate', memory_tool: 'dup' },
      { question_id: '2', diagnosis: 'WHATEVER', technique: 'bogus', headline: '', memory_tool: 'no headline' },
    ],
  };
  const { setNote, cards } = validateCards(raw, misses);
  assert.equal(setNote, 'Solid on security basics.');
  assert.equal(cards.length, 1);
  const [c] = cards;
  assert.equal(c.correctAnswer, 'Cloud Armor answer');
  assert.equal(c.recallCue, '');
  assert.equal(c.visualCue, null);
  assert.deepEqual(c.lockIn, { prompt: 'Which one stops a DDoS?', answer: 'Cloud Armor' });
  assert.deepEqual(c.nudges, ['Which Armor stands at the door?', 'Door or brain?', 'Fourth one?']);
  assert.equal(c.keyConcern, null);
  assert.equal(c.technique, 'contrast_pair');
  assert.deepEqual(validateCards('junk', misses), { setNote: '', cards: [] });
});

test('validateCards: unknown technique and diagnosis fall back; at most 5 cards; a key concern is kept', () => {
  const misses = Array.from({ length: 7 }, (_, i) => missInput(q(String(i), `C${i}`), [], []));
  const raw = { set_note: '', cards: misses.map((m) => ({ question_id: m.question_id, diagnosis: 'X', technique: 'Y', headline: 'H', memory_tool: 'T', key_concern: 'The key says A but the notes say B.' })) };
  const { cards } = validateCards(raw, misses);
  assert.equal(cards.length, 5);
  assert.equal(cards[0].diagnosis, 'CONFUSION');
  assert.equal(cards[0].technique, 'contrast_pair');
  assert.equal(cards[0].keyConcern, 'The key says A but the notes say B.');
});

test('memoryCardsView: writing right after grading, the stored cards without nudges, nothing when no misses or long ago', () => {
  const gradedAt = '2026-10-24T12:00:00.000Z';
  const at = (ms) => new Date(Date.parse(gradedAt) + ms);
  const session = { quiz: { questions: [q('1', 'Osmosis')], grade: { gradedAt } } };
  assert.deepEqual(memoryCardsView(session, at(1000)), { gradedAt, status: 'writing', setNote: '', cards: [] });
  assert.equal(memoryCardsView(session, at(WRITING_WINDOW_MS + 1)), null);
  assert.equal(memoryCardsView({ quiz: { questions: [q('1', 'Osmosis', { right: true })], grade: { gradedAt } } }, at(1000)), null);
  assert.equal(memoryCardsView({ quiz: { questions: [q('1', 'Osmosis')], grade: null } }, at(1000)), null);
  const card = { questionId: '1', concept: 'Osmosis', diagnosis: 'GAP', technique: 'analogy', headline: 'H', whyYouMissed: '', correctAnswer: 'A', memoryTool: 'T', recallCue: '', visualCue: null, lockIn: null, nudges: ['n?'], keyConcern: null };
  const ready = memoryCardsView({ ...session, memoryCards: { gradedAt, status: 'ready', setNote: 'Nice.', cards: [card], version: 'v1', updatedAt: gradedAt } }, at(WRITING_WINDOW_MS * 10));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.cards[0].techniqueLabel, 'Think of it like');
  assert.equal('nudges' in ready.cards[0], false);
  const failed = memoryCardsView({ ...session, memoryCards: { gradedAt, status: 'failed', setNote: '', cards: [], version: 'v1', updatedAt: gradedAt } }, at(1000));
  assert.equal(failed.status, 'failed');
  // Cards of an earlier set on the same session don't show for a newer grade.
  assert.equal(memoryCardsView({ ...session, memoryCards: { gradedAt: '2026-10-01T00:00:00.000Z', status: 'ready', setNote: '', cards: [card], version: 'v1', updatedAt: '' } }, at(WRITING_WINDOW_MS + 1)), null);
});
