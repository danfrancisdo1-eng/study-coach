// D-303: the web half of D-206. Sends a chat message to POST /api/study/chat/stream and reads the coach's
// reply while it is written (the browser's fetch streams the body). The event format and parser are the
// phone's (lib/chat-stream.ts); this file is only the browser transport.
import { apiTarget, type HomeChat, type HomeChatInput } from '@workspace/api-client-react';
import { SseParser } from '@phone-lib/chat-stream';

/** Shaped like the generated client's ApiError, so premiumCode and the error line read it the same way. */
export class StreamError extends Error {
  constructor(readonly status: number, readonly data: unknown) {
    super(typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `Request failed (${status})`);
  }
}

/**
 * Sends the message; `onText` hears each piece of the reply as it arrives. Resolves with the saved chat
 * (the same body POST /study/chat returns). A request the server stops before the coach writes comes back
 * as plain JSON: an error status rejects with StreamError, a 200 resolves at once.
 */
export async function streamChatMessage(data: HomeChatInput, onText: (text: string) => void): Promise<HomeChat> {
  const { url, headers } = await apiTarget('/api/study/chat/stream');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream, application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    throw new StreamError(0, { error: 'No connection right now. Nothing was lost. Try again in a moment.' });
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new StreamError(response.status, body);
    return body as HomeChat;
  }
  const parser = new SseParser();
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = reader ? await reader.read().catch(() => ({ done: true, value: undefined })) : { done: true, value: undefined };
    const text = !reader ? await response.text() : done ? decoder.decode() : decoder.decode(value, { stream: true });
    for (const event of parser.push(done && !text.endsWith('\n\n') ? `${text}\n\n` : text)) {
      if (event.event === 'delta') onText(String((event.data as { text?: unknown })?.text ?? ''));
      else if (event.event === 'done') return event.data as HomeChat;
      else if (event.event === 'error') {
        const body = event.data as { status?: number };
        throw new StreamError(typeof body?.status === 'number' ? body.status : 502, event.data);
      }
    }
    if (done) throw new StreamError(0, { error: 'No connection right now. Nothing was lost. Try again in a moment.' });
  }
}
