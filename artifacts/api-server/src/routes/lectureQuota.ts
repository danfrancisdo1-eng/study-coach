// A per-process safety bound for the single-instance prototype. Distributed
// deployments need a shared quota store and a shared concurrency coordinator.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 2;
const MAX_CONCURRENT = 2;

const usage = new Map<string, { count: number; resetAt: number; active: boolean }>();
let activeCount = 0;
let reservations = 0;

export type QuotaResult =
  // refund(): give the attempt back when nothing was transcribed (provider
  // rejected the request, unreadable audio). Idempotent; call before release().
  | { allowed: true; release: () => void; refund: () => void }
  | { allowed: false; reason: 'quota' | 'busy'; retryAfterSeconds: number };

export function reserveTranscription(userId: string, now = Date.now()): QuotaResult {
  // Cleanup is amortized to avoid retaining accounts that no longer submit audio.
  if (++reservations % 100 === 0) {
    for (const [id, entry] of usage) if (!entry.active && entry.resetAt <= now) usage.delete(id);
  }
  const previous = usage.get(userId);
  const entry = previous && previous.resetAt > now
    ? previous
    : { count: 0, resetAt: now + WINDOW_MS, active: false };
  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, reason: 'quota', retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  if (entry.active || activeCount >= MAX_CONCURRENT) {
    return { allowed: false, reason: 'busy', retryAfterSeconds: 30 };
  }
  entry.count++;
  entry.active = true;
  usage.set(userId, entry);
  activeCount++;
  let released = false;
  let refunded = false;
  return {
    allowed: true,
    refund: () => {
      if (refunded) return;
      refunded = true;
      entry.count = Math.max(0, entry.count - 1);
    },
    release: () => {
      if (released) return;
      released = true;
      entry.active = false;
      activeCount--;
    },
  };
}