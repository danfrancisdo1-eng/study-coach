// D-224: Class or Certification Exam wording, a class's own date, and switching a mistaken exam to a class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dateError, dateLabel, keptAsExam, kindHint, offerClassSwitch, withKind } from './course-kind.ts';
import { classCountdown, dateHint, kindKicker, shortDate } from './exam-date.ts';

const today = new Date(2026, 10, 7); // Sat, Nov 7, 2026

test('the hint under the choice, in Dan\'s words', () => {
  assert.equal(kindHint('course'), 'Class: a college or high school course, with quizzes, tests and finals, like BIO 114.');
  assert.match(kindHint('exam'), /^Certification: a professional or licensing exam, like AWS, NCLEX or real estate\./);
  assert.match(kindHint(null), /Class: a college or high school course\. Certification:/);
});

test('each kind has its own date wording', () => {
  assert.equal(dateLabel('course'), 'Next quiz or test');
  assert.equal(dateLabel('exam'), 'Exam date');
  assert.equal(dateHint('course', 'Nov 9', today), 'Next quiz or test: Mon, Nov 9, 2026');
  assert.equal(dateHint('exam', 'Nov 9', today), 'Exam on Mon, Nov 9, 2026');
  assert.equal(dateHint('course', 'someday', today), 'Try a date like Nov 14 or 11/14/2026');
  assert.equal(dateHint('course', '  ', today), '');
  assert.match(dateError('course'), /quiz or test date/);
});

test('the course screen kicker and the class countdown', () => {
  assert.equal(shortDate('2026-11-09'), 'Mon, Nov 9');
  assert.equal(kindKicker({ kind: 'exam', examDate: '2026-11-09' }), 'Certification exam · Mon, Nov 9, 2026');
  assert.equal(kindKicker({ kind: 'exam' }), 'Certification exam');
  assert.equal(kindKicker({ kind: 'course', examDate: '2026-11-09' }), 'Class · Next quiz or test Mon, Nov 9');
  assert.equal(kindKicker({ kind: 'course' }), 'Class');
  assert.equal(classCountdown({ kind: 'course', examDate: '2026-11-09' }, today), 'Mon, Nov 9 · in 2 days');
  assert.equal(classCountdown({ kind: 'course', examDate: '2026-11-08' }, today), 'Sun, Nov 8 · tomorrow');
  assert.equal(classCountdown({ kind: 'course', examDate: '2026-11-07' }, today), 'Sat, Nov 7 · today');
  assert.equal(classCountdown({ kind: 'course', examDate: '2026-11-06' }, today), null, 'a passed date shows nothing');
  assert.equal(classCountdown({ kind: 'exam', examDate: '2026-11-09' }, today), null, 'exams keep their own header');
  assert.equal(classCountdown({ kind: 'course' }, today), null);
});

test('the switch card: only an exam whose guide lookup found nothing, until kept', () => {
  const mistaken = { id: 'b', kind: 'exam', examDate: '2026-11-09', examGuide: { found: false, notes: 'looks like a classroom worksheet' } };
  assert.equal(offerClassSwitch(mistaken), true);
  assert.equal(offerClassSwitch({ ...mistaken, keepAsExam: true }), false);
  assert.equal(offerClassSwitch({ ...mistaken, examGuide: { found: true, sections: [] } }), false);
  assert.equal(offerClassSwitch({ ...mistaken, examGuide: undefined }), false, 'not before the lookup ran');
  assert.equal(offerClassSwitch({ ...mistaken, kind: 'course' }), false);
});

test('switching keeps everything and Undo restores it; keeping hides the card', () => {
  const courses = [{ id: 'a', kind: 'course', name: 'BIO 114' }, { id: 'b', kind: 'exam', name: 'Bio Packet 10', examDate: '2026-11-09', examGuide: { found: false } }];
  const switched = withKind(courses, 'b', 'course');
  assert.deepEqual(switched[1], { id: 'b', kind: 'course', name: 'Bio Packet 10', examDate: '2026-11-09', examGuide: { found: false } });
  assert.equal(switched[0], courses[0], 'other courses untouched');
  assert.deepEqual(withKind(switched, 'b', 'exam'), courses);
  assert.equal(keptAsExam(courses, 'b')[1].keepAsExam, true);
});
