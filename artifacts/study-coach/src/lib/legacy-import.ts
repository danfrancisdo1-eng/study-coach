import { restoreStudyData, type StudyData } from './study';

/**
 * Reads the original browser-local workspace without changing or deleting it.
 * Import must be an explicit action after sign-in; this helper is never called
 * as part of account creation.
 */
export function readLegacyStudyData(): Promise<StudyData | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('study-coach-local-v1', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) {
        request.result.createObjectStore('state');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readonly');
      const read = tx.objectStore('state').get('study');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const saved = read.result as Partial<StudyData> | undefined;
        resolve(saved ? restoreStudyData(saved) : null);
      };
      tx.oncomplete = () => db.close();
    };
  });
}