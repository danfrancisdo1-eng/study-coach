// Sends one file to the server's extraction route, streaming it from disk with upload progress
// (D-126), like lecture uploads (lecture-transcribe.ts). Errors carry {status, data: {error}} so
// friendlyError shows the server's sentence.
import { UploadTask, UploadType, type File } from 'expo-file-system';
import type { StudyMaterialExtraction } from '@workspace/api-client-react';

export class MaterialUploadError extends Error {
  constructor(public status: number, public data: { error?: string } | null, message: string) {
    super(message);
  }
}

export async function uploadMaterial(options: {
  file: File;
  filename: string;
  token: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<StudyMaterialExtraction> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new MaterialUploadError(0, null, 'No connection right now.');
  if (!options.token) throw new MaterialUploadError(401, { error: 'Sign in again, then retry.' }, 'Sign in again, then retry.');
  const task = new UploadTask(options.file, `https://${domain}/api/study/materials/extract`, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/octet-stream', 'X-Filename': options.filename },
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
    throw new MaterialUploadError(0, null, 'network failed');
  }
  let body: unknown = null;
  try {
    body = JSON.parse(result.body);
  } catch {
    // Non-JSON error page: handled by status below.
  }
  if (result.status < 200 || result.status >= 300) {
    const error = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : undefined;
    throw new MaterialUploadError(result.status, error ? { error } : null, error ?? `HTTP ${result.status}`);
  }
  const extraction = body as StudyMaterialExtraction | null;
  if (!extraction || typeof extraction.text !== 'string') throw new MaterialUploadError(502, null, 'server error');
  return extraction;
}
