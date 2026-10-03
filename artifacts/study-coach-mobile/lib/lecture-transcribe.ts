// Sends one lecture recording to the server's transcription route, streaming it from
// disk (no full copy in memory) with upload progress. The recording stays on the phone.
import { UploadTask, UploadType, type File } from 'expo-file-system';
import { transcriptionErrorMessage, type TranscriptSegment } from './lecture-recording';

export class TranscriptionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function transcribeRecording(options: {
  file: File;
  token: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<TranscriptSegment[]> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new TranscriptionError(0, transcriptionErrorMessage(0));
  if (!options.token) throw new TranscriptionError(401, transcriptionErrorMessage(401));
  const task = new UploadTask(options.file, `https://${domain}/api/coach/transcribe`, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/octet-stream',
      'X-Audio-Type': 'audio/mp4',
    },
    signal: options.signal,
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) options.onProgress?.(Math.min(1, bytesSent / totalBytes));
    },
  });
  let result;
  try {
    result = await task.uploadAsync();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new TranscriptionError(0, transcriptionErrorMessage(0));
  }
  let body: unknown = null;
  try {
    body = JSON.parse(result.body);
  } catch {
    // Non-JSON error page: handled by status below.
  }
  if (result.status < 200 || result.status >= 300) {
    const serverMessage = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : undefined;
    throw new TranscriptionError(result.status, transcriptionErrorMessage(result.status, serverMessage));
  }
  const segments = body && typeof body === 'object' && 'segments' in body && Array.isArray(body.segments) ? body.segments : null;
  if (!segments) throw new TranscriptionError(502, transcriptionErrorMessage(502));
  return segments.flatMap((segment: unknown) =>
    segment && typeof segment === 'object' && 'start' in segment && 'end' in segment && 'text' in segment &&
    typeof segment.start === 'number' && typeof segment.end === 'number' && typeof segment.text === 'string'
      ? [{ start: segment.start, end: segment.end, text: segment.text }]
      : []);
}
