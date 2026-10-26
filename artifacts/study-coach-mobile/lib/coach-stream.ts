// D-206: sends a chat message to POST /study/chat/stream and reads the coach's reply while it is written.
// expo/fetch streams the response body (React Native's own fetch waits for the whole body).
import { fetch } from 'expo/fetch';
import { apiTarget, type HomeChat, type HomeChatInput } from '@workspace/api-client-react';
import { SseParser } from '@/lib/chat-stream';

/** Shaped like the generated client's ApiError, so friendlyError and premiumCode read it the same way. */
export class StreamError extends Error {
  constructor(readonly status: number, readonly data: unknown) {
    super(typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `Request failed (${status})`);
  }
}

/**
 * Sends the message; `onText` hears each piece of the reply text as it arrives. Resolves with the saved
 * chat (the same body POST /study/chat returns). A request the server stops before the coach writes
 * comes back as plain JSON: an error status rejects with StreamError, a 200 resolves at once.
 */
export async function streamChatMessage(data: HomeChatInput, onText: (text: string) => void): Promise<HomeChat> {
  const { url, headers } = await apiTarget('/api/study/chat/stream');
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream, application/json' },
    body: JSON.stringify(data),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new StreamError(response.status, body);
    return body as HomeChat;
  }
  const parser = new SseParser();
  const reader = typeof TextDecoder !== 'undefined' ? response.body?.getReader() : undefined;
  const decoder = reader ? new TextDecoder() : null;
  for (;;) {
    // No stream reader on this device: the whole body at once (the reply still shows, just not word by word as written).
    const { done, value } = reader ? await reader.read() : { done: true, value: undefined };
    const text = !reader ? await response.text() : done ? decoder!.decode() : decoder!.decode(value, { stream: true });
    const events = parser.push(done && !text.endsWith('\n\n') ? `${text}\n\n` : text);
    for (const event of events) {
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
