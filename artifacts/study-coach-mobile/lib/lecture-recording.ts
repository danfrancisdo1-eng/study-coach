// Pure lecture-recording rules shared by the lecture screens. No native imports, so
// node --test can exercise it directly (see lecture-recording.test.mjs).

/** The server transcribes at most two hours per lecture; recording stops there. */
export const MAX_RECORDING_SECONDS = 2 * 60 * 60;
/** Server upload limit for transcription. Mono AAC at 48 kbps keeps 2 hours near 43 MB. */
export const MAX_TRANSCRIBE_BYTES = 50 * 1024 * 1024;
/** Warn this long before the automatic stop. */
export const RECORDING_LIMIT_WARNING_SECONDS = 5 * 60;

export type PendingRecording = {
  localId: string;
  courseId: string;
  title: string;
  recordedAt: string;
  durationSeconds: number;
};

export type TranscriptSegment = { start: number; end: number; text: string };

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Spoken-friendly length for VoiceOver, e.g. "1 hour 5 minutes". */
export function spokenDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m || !h) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function defaultLectureTitle(recordedAt: Date): string {
  return `Lecture ${MONTHS[recordedAt.getMonth()]} ${recordedAt.getDate()}`;
}

export function normalizedTitle(input: string, recordedAt: Date): string {
  const trimmed = input.replace(/\s+/g, ' ').trim().slice(0, 200);
  return trimmed || defaultLectureTitle(recordedAt);
}

/** Whole seconds, at least 1 (the server rejects 0-second lectures). */
export function recordedSeconds(durationMillis: number): number {
  return Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.round(durationMillis / 1000)));
}

export function recordingLimitState(elapsedSeconds: number): 'ok' | 'warning' | 'stop' {
  if (elapsedSeconds >= MAX_RECORDING_SECONDS) return 'stop';
  if (elapsedSeconds >= MAX_RECORDING_SECONDS - RECORDING_LIMIT_WARNING_SECONDS) return 'warning';
  return 'ok';
}

/** Why a saved recording can't be sent for transcription, or null if it can. */
export function transcriptionBlocker(sizeBytes: number | null, durationSeconds: number): string | null {
  if (sizeBytes === null || sizeBytes <= 0) return 'The recording file is missing from this iPhone.';
  if (sizeBytes > MAX_TRANSCRIBE_BYTES) return 'This recording is larger than 50 MB, so it can’t be transcribed in one piece.';
  if (durationSeconds > MAX_RECORDING_SECONDS) return 'Recordings longer than two hours can’t be transcribed in one piece.';
  return null;
}

/** Friendly message for a failed transcription request. The audio is always kept. */
export function transcriptionErrorMessage(status: number, serverMessage?: string): string {
  if (status === 401) return 'Your sign-in expired. Sign in again, then retry. Your recording is still saved on this iPhone.';
  if (status === 429) return serverMessage || 'Transcription is limited right now. Your recording is still saved on this iPhone; try again later.';
  if (status === 400 || status === 413) return serverMessage || 'This recording couldn’t be read. It is still saved on this iPhone.';
  if (status === 0) return 'No connection. Your recording is still saved on this iPhone; retry when you’re online.';
  return 'Transcription didn’t finish. Your recording is still saved on this iPhone; try again.';
}

export function parsePendingRecording(text: string): PendingRecording | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof value.localId === 'string' && /^[a-z0-9-]{8,64}$/i.test(value.localId) &&
      typeof value.courseId === 'string' && value.courseId.length > 0 &&
      typeof value.title === 'string' &&
      typeof value.recordedAt === 'string' && !Number.isNaN(Date.parse(value.recordedAt)) &&
      typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0
    ) {
      return {
        localId: value.localId,
        courseId: value.courseId,
        title: value.title,
        recordedAt: value.recordedAt,
        durationSeconds: value.durationSeconds,
      };
    }
  } catch {
    // Corrupt sidecar: treated as unknown; the audio file itself is never deleted for this.
  }
  return null;
}

/** Applies the student's edits; drops passages they emptied. */
export function editedSegments(original: TranscriptSegment[], edits: Record<number, string>): TranscriptSegment[] {
  return original
    .map((segment, index) => ({ ...segment, text: (edits[index] ?? segment.text).trim() }))
    .filter((segment) => segment.text.length > 0);
}

export function transcriptHasText(segments: TranscriptSegment[]): boolean {
  return segments.some((segment) => segment.text.trim().length > 0);
}
