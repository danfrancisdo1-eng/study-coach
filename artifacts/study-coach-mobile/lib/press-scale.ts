/**
 * How far a control squashes while pressed (D-179): buttons a little, the round send button
 * more (it is small, so the same fraction would be invisible), big answer cards barely.
 */
export const PRESS_SCALE = { button: 0.96, icon: 0.92, card: 0.98 } as const;

/**
 * The scale to draw at, from how far down the press is (0 = up, 1 = fully pressed).
 * Marked a worklet because PressScale calls it from an animated style on the UI thread.
 */
export function pressScaleAt(target: number, down: number): number {
  'worklet';
  return 1 - down * (1 - target);
}
