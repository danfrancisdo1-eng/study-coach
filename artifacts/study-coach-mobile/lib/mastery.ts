/**
 * Mastery bars (D-171, Dan's OK on the design review): a topic's bar fills with the share the
 * student got RIGHT, so a full bar means the topic is known, as it does on the score card's
 * "By section" rows. Before this the course page filled the bar with the missed share in red
 * (D-076), so a topic missed 7 of 8 times drew an almost full bar, which reads as achievement.
 * At 70% and up the bar takes the primary colour; below it a neutral grey, so the colour is a
 * second cue to the number, never the only one.
 */
export const MASTERY_STRONG = 0.7;

export function masteryShare(right: number, total: number): number {
  if (!total || total < 0) return 0;
  return Math.min(1, Math.max(0, right / total));
}

export function masteryIsStrong(right: number, total: number): boolean {
  return total > 0 && masteryShare(right, total) >= MASTERY_STRONG;
}

/** "right/asked" for the fixed value column: "7/10". */
export function masteryValue(right: number, total: number): string {
  return `${right}/${total}`;
}

/** The VoiceOver label: "Semantic segmentation: 7 of 10 right". */
export function masteryLabel(topic: string, right: number, total: number): string {
  return `${topic}: ${right} of ${total} right`;
}
