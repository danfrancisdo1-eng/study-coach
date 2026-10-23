/**
 * The aurora (D-179): two or three soft colored glows that sit behind every screen and drift
 * very slowly. Pure layout data so the component stays small and the numbers are testable.
 * Positions are points from the screen's top-left (negative = partly off-screen), sized for a
 * 390-pt-wide phone; wider phones just see a little more of each glow.
 */
export type AuroraBlob = {
  /** Hex color of the glow's center. */
  color: string;
  /** Opacity at the center; it fades to 0 at `fade` of the radius. */
  alpha: number;
  size: number;
  top: number;
  left: number;
  /** How far the glow drifts over one cycle, in points. */
  dx: number;
  dy: number;
};

/** Fraction of the radius where the glow has fully faded. */
export const AURORA_FADE = 0.62;

/** One drift cycle (one way); it then eases back, forever. */
export const AURORA_DRIFT_MS = 60_000;

const DARK: AuroraBlob[] = [
  { color: '#2b4fd8', alpha: 0.6, size: 460, top: 40, left: -120, dx: 50, dy: 30 },
  { color: '#f2b544', alpha: 0.32, size: 420, top: 120, left: 110, dx: -40, dy: 50 },
  { color: '#7c9bff', alpha: 0.35, size: 320, top: 260, left: 60, dx: 30, dy: -40 },
];

const LIGHT: AuroraBlob[] = [
  { color: '#2b4fd8', alpha: 0.22, size: 380, top: -120, left: -60, dx: 50, dy: 30 },
  { color: '#f2b544', alpha: 0.28, size: 320, top: -40, left: 190, dx: -40, dy: 50 },
];

export function auroraBlobs(scheme: 'light' | 'dark'): AuroraBlob[] {
  return scheme === 'dark' ? DARK : LIGHT;
}

/** With Reduce Motion on, the glows hold still: no drift at all. */
export function auroraDriftMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : AURORA_DRIFT_MS;
}
