/**
 * Frosted glass numbers (D-179), kept pure so the contrast test can composite them: the wash
 * that sits over the blur, and the hairline around a glass card.
 */
export type Scheme = 'light' | 'dark';

/** The wash over the blur as [r, g, b, alpha]. Without a native blur (Android) it is nearly opaque. */
export function glassWash(scheme: Scheme, blurred: boolean): [number, number, number, number] {
  if (scheme === 'dark') return [24, 34, 53, blurred ? 0.62 : 0.94];
  return [255, 255, 255, blurred ? 0.65 : 0.94];
}

export function glassWashCss(scheme: Scheme, blurred: boolean): string {
  const [r, g, b, a] = glassWash(scheme, blurred);
  return `rgba(${r},${g},${b},${a})`;
}

/** A hairline of ink at 8% (light) or white at 10% (dark). */
export function glassBorderColor(scheme: Scheme): string {
  return scheme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(21,25,42,0.08)';
}
