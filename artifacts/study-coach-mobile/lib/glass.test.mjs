import test from 'node:test';
import assert from 'node:assert/strict';
import colors from '../constants/colors.ts';
import { auroraBlobs } from './aurora.ts';
import { glassBorderColor, glassWash, glassWashCss } from './glass.ts';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (top, alpha, under) => under.map((u, i) => Math.round(top[i] * alpha + u * (1 - alpha)));
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

test('text on a glass card keeps 4.5:1 against the strongest aurora glow behind it (D-179)', () => {
  for (const scheme of ['light', 'dark']) {
    const p = colors[scheme];
    // Worst case: the brightest glow at full strength sitting right behind the card.
    const strongest = auroraBlobs(scheme).reduce((a, b) => (b.alpha > a.alpha ? b : a));
    const backdrop = over(hex(strongest.color), strongest.alpha, hex(p.background));
    for (const blurred of [true, false]) {
      const [r, g, b, a] = glassWash(scheme, blurred);
      const surface = over([r, g, b], a, backdrop);
      assert.ok(contrast(hex(p.foreground), surface) >= 4.5, `${scheme} ${blurred ? 'blurred' : 'plain'}: foreground ${contrast(hex(p.foreground), surface).toFixed(2)}`);
      assert.ok(contrast(hex(p.mutedForeground), surface) >= 4.5, `${scheme} ${blurred ? 'blurred' : 'plain'}: muted ${contrast(hex(p.mutedForeground), surface).toFixed(2)}`);
    }
  }
});

test('the wash is nearly opaque where there is no native blur, and the hairline is faint', () => {
  assert.ok(glassWash('light', false)[3] >= 0.9 && glassWash('dark', false)[3] >= 0.9);
  assert.ok(glassWash('light', true)[3] < 0.75 && glassWash('dark', true)[3] < 0.75);
  assert.equal(glassWashCss('light', true), 'rgba(255,255,255,0.65)');
  assert.match(glassBorderColor('light'), /0\.08\)$/);
  assert.match(glassBorderColor('dark'), /0\.10\)$/);
});
