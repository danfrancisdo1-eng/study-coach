// Web upload with progress (D-126): same route and headers as the generated client
// (POST /api/study/materials/extract, X-Filename, same-origin session), via XMLHttpRequest so the
// browser reports bytes sent. Errors carry the server's sentence.
import type { StudyMaterialExtraction } from '@workspace/api-client-react';

export function uploadMaterial(file: File, onProgress: (fraction: number) => void): Promise<StudyMaterialExtraction> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/study/materials/extract');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream'); // as the generated client sends it
    xhr.setRequestHeader('X-Filename', file.name);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total)); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && body && typeof (body as { text?: unknown }).text === 'string') { onProgress(1); resolve(body as StudyMaterialExtraction); return; }
      const message = body && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : 'Extraction failed.';
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('No connection right now. Nothing was lost. Try again in a moment.'));
    xhr.send(file);
  });
}
