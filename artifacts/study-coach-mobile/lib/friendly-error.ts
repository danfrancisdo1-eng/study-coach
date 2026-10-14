/**
 * What a student reads when something fails (D-065, usability review finding 2): never a
 * stack trace or a native exception, always one plain sentence. The server's own messages
 * (written for students) pass through; network failures, version conflicts and server
 * errors get fixed wording.
 */
const NETWORK = /network|fetch failed|failed to fetch|connection (was )?lost|timed? ?out|offline|not connected|unexpectedexception/i;
const TECHNICAL = /exception|\.swift|\.java|\.kt\b|\(at |stack|undefined is not|cannot read propert|typeerror|syntaxerror|json parse|https?:\/\/|sess_/i;

export const MESSAGES = {
  network: 'No connection right now. Nothing was lost. Try again in a moment.',
  conflict: 'This was updated on another device and has been refreshed. Try that again.',
  server: 'RapidRecall AI had a problem on its side. Try again in a moment.',
  generic: 'Something went wrong. Try again.',
} as const;

export function friendlyError(problem: unknown): string {
  if (!problem || typeof problem !== 'object') return MESSAGES.generic;
  const p = problem as { status?: unknown; data?: { error?: unknown }; message?: unknown };
  const status = typeof p.status === 'number' ? p.status : null;
  if (status === 409) return MESSAGES.conflict;
  const serverText = p.data && typeof p.data.error === 'string' ? p.data.error.trim() : '';
  if (serverText && !TECHNICAL.test(serverText) && !NETWORK.test(serverText)) return serverText;
  const message = typeof p.message === 'string' ? p.message : '';
  if (NETWORK.test(message) || NETWORK.test(serverText) || status === 0) return MESSAGES.network;
  if (status !== null && status >= 500) return MESSAGES.server;
  if (message && !TECHNICAL.test(message) && message.length <= 160) return message;
  return MESSAGES.generic;
}
