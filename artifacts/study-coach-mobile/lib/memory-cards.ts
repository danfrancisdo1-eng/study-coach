// Memory cards (D-194): the pure parts of the cards screen and its bar, so unit tests load them.
// The server writes the cards after grading (status "writing", then "ready" or "failed").

export type CardsStatus = 'writing' | 'ready' | 'failed';
export type CardsLike = { status: CardsStatus; cards: readonly unknown[] } | null | undefined;

/** The after-set chip the cards replace while they exist (the coach still answers it when they don't). */
export const MEMORY_TIPS_CHIP = 'Memory tips for the misses';
export const isMemoryTipsChip = (chip: string) => /^memory tips for the misses$/i.test(chip.trim());

/** The bar above the chat box, or null when there is nothing to show. */
export function cardsBarLabel(view: CardsLike, seen: number): string | null {
  if (!view || view.status === 'failed') return null;
  if (view.status === 'writing') return 'Writing your memory cards…';
  const total = view.cards.length;
  if (!total) return null;
  if (seen <= 0) return `${total} memory ${total === 1 ? 'card' : 'cards'} for your misses`;
  if (seen >= total) return `Memory cards: all ${total} done. Go again?`;
  return `Memory cards: ${seen} of ${total} done`;
}

/** Where to reopen: the first card not yet seen, or the first card again once all were seen. */
export function startIndex(seen: number, total: number): number {
  return seen > 0 && seen < total ? seen : 0;
}

/** "1 of 5". */
export const positionLabel = (index: number, total: number) => `${index + 1} of ${total}`;

/** The stored progress for one set (AsyncStorage), kept per student and session. */
export const progressKey = (userId: string, sessionId: string) => `study-coach-cards:${userId}:${sessionId}`;
export function parseSeen(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
