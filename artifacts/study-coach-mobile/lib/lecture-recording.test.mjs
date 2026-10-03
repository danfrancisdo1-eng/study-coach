import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECORDING_SECONDS, MAX_TRANSCRIBE_BYTES, defaultLectureTitle, editedSegments, formatDuration, normalizedTitle,
  parsePendingRecording, recordedSeconds, recordingLimitState, spokenDuration, transcriptHasText,
  transcriptionBlocker, transcriptionErrorMessage,
} from './lecture-recording.ts';

test('durations format for the timer and for VoiceOver', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3909), '1:05:09');
  assert.equal(formatDuration(-4), '0:00');
  assert.equal(spokenDuration(30), '0 minutes');
  assert.equal(spokenDuration(3900), '1 hour 5 minutes');
  assert.equal(spokenDuration(7200), '2 hours');
});

test('titles default to the recording date and are trimmed and capped', () => {
  const date = new Date(2026, 9, 3, 10, 0);
  assert.equal(defaultLectureTitle(date), 'Lecture Oct 3');
  assert.equal(normalizedTitle('   ', date), 'Lecture Oct 3');
  assert.equal(normalizedTitle('  Cell   respiration ', date), 'Cell respiration');
  assert.equal(normalizedTitle('x'.repeat(300), date).length, 200);
});

test('recorded length is whole seconds, at least 1, at most the limit', () => {
  assert.equal(recordedSeconds(0), 1);
  assert.equal(recordedSeconds(1499), 1);
  assert.equal(recordedSeconds(61_600), 62);
  assert.equal(recordedSeconds(9_000_000), MAX_RECORDING_SECONDS);
});

test('recording warns five minutes before the two-hour stop', () => {
  assert.equal(recordingLimitState(0), 'ok');
  assert.equal(recordingLimitState(MAX_RECORDING_SECONDS - 301), 'ok');
  assert.equal(recordingLimitState(MAX_RECORDING_SECONDS - 300), 'warning');
  assert.equal(recordingLimitState(MAX_RECORDING_SECONDS), 'stop');
});

test('transcription is blocked for missing, oversized or too-long recordings', () => {
  assert.match(transcriptionBlocker(null, 60), /missing/);
  assert.match(transcriptionBlocker(0, 60), /missing/);
  assert.match(transcriptionBlocker(MAX_TRANSCRIBE_BYTES + 1, 60), /50 MB/);
  assert.match(transcriptionBlocker(1000, MAX_RECORDING_SECONDS + 1), /two hours/);
  assert.equal(transcriptionBlocker(43 * 1024 * 1024, MAX_RECORDING_SECONDS), null);
});

test('every transcription error tells the student the audio is still saved', () => {
  for (const status of [0, 401, 429, 400, 413, 502, 500]) {
    assert.match(transcriptionErrorMessage(status), /still saved on this iPhone/, String(status));
  }
  assert.equal(transcriptionErrorMessage(429, 'Two transcription attempts are available every 24 hours.'), 'Two transcription attempts are available every 24 hours.');
});

test('pending-recording sidecars are validated; corrupt ones are ignored', () => {
  const good = { localId: 'a1b2c3d4-0000', courseId: 'bio', title: 'Lecture Oct 3', recordedAt: '2026-10-03T14:00:00.000Z', durationSeconds: 3000 };
  assert.deepEqual(parsePendingRecording(JSON.stringify(good)), good);
  assert.equal(parsePendingRecording('{not json'), null);
  assert.equal(parsePendingRecording(JSON.stringify({ ...good, localId: '../../etc' })), null);
  assert.equal(parsePendingRecording(JSON.stringify({ ...good, durationSeconds: 0 })), null);
  assert.equal(parsePendingRecording(JSON.stringify({ ...good, recordedAt: 'yesterday' })), null);
  assert.deepEqual(parsePendingRecording(JSON.stringify({ ...good, extra: 'ignored' })), good);
});

test('transcript edits are applied and emptied passages removed', () => {
  const original = [{ start: 0, end: 300, text: 'Glycolsis happens' }, { start: 300, end: 600, text: 'um' }, { start: 600, end: 900, text: 'ETC makes ATP' }];
  const result = editedSegments(original, { 0: 'Glycolysis happens in the cytoplasm ', 1: '  ' });
  assert.deepEqual(result, [{ start: 0, end: 300, text: 'Glycolysis happens in the cytoplasm' }, { start: 600, end: 900, text: 'ETC makes ATP' }]);
  assert.equal(transcriptHasText(result), true);
  assert.equal(transcriptHasText(editedSegments(original, { 0: '', 1: '', 2: ' ' })), false);
});
