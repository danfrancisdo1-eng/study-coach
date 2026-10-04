// Lecture audio on this device. Recordings live in the app's documents directory (not
// the cache, which iOS may purge) and are deleted only when the student asks.
//   pending-<localId>.m4a + .json   recorded, not yet registered with the account
//   <lectureId>.m4a                 registered lecture whose audio is still on the phone
import { Directory, File, Paths } from 'expo-file-system';
import { parsePendingRecording, type PendingRecording } from './lecture-recording';

function lectureDirectory(): Directory {
  const directory = new Directory(Paths.document, 'lectures');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

const pendingAudio = (localId: string) => new File(lectureDirectory(), `pending-${localId}.m4a`);
const pendingInfo = (localId: string) => new File(lectureDirectory(), `pending-${localId}.json`);

/** Moves a finished recording out of the recorder's temporary location. */
export async function keepRecording(recordingUri: string, info: PendingRecording): Promise<void> {
  const destination = pendingAudio(info.localId);
  await new File(recordingUri).move(destination);
  const sidecar = pendingInfo(info.localId);
  if (!sidecar.exists) sidecar.create();
  sidecar.write(JSON.stringify(info));
}

export function updatePendingRecording(info: PendingRecording): void {
  const sidecar = pendingInfo(info.localId);
  if (!sidecar.exists) sidecar.create();
  sidecar.write(JSON.stringify(info));
}

export async function listPendingRecordings(): Promise<PendingRecording[]> {
  const pending: PendingRecording[] = [];
  for (const entry of lectureDirectory().list()) {
    if (!(entry instanceof File) || !/^pending-.+\.json$/.test(entry.name)) continue;
    const info = parsePendingRecording(await entry.text());
    if (info && pendingAudio(info.localId).exists) pending.push(info);
  }
  return pending.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/** After the account accepts the lecture, the audio is filed under its lecture id. */
export async function attachRecording(localId: string, lectureId: string): Promise<void> {
  await pendingAudio(localId).move(new File(lectureDirectory(), `${lectureId}.m4a`));
  const sidecar = pendingInfo(localId);
  if (sidecar.exists) sidecar.delete();
}

export function lectureAudio(lectureId: string): File | null {
  const file = new File(lectureDirectory(), `${lectureId}.m4a`);
  return file.exists ? file : null;
}

export function deleteLectureAudio(lectureId: string): void {
  lectureAudio(lectureId)?.delete();
}

export function discardPendingRecording(localId: string): void {
  const audio = pendingAudio(localId);
  if (audio.exists) audio.delete();
  const sidecar = pendingInfo(localId);
  if (sidecar.exists) sidecar.delete();
}
