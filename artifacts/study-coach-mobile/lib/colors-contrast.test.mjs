import test from 'node:test';
import assert from 'node:assert/strict';
import colors from '../constants/colors.ts';

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('the primary button label reads on both ends of the gradient, in both modes (D-179)', () => {
  for (const scheme of ['light', 'dark']) {
    const p = colors[scheme];
    assert.ok(contrast(p.primaryForeground, p.primary) >= 4.5, `${scheme}: label on primary`);
    assert.ok(contrast(p.primaryForeground, p.primaryGradientEnd) >= 4.5, `${scheme}: label on the gradient end (${contrast(p.primaryForeground, p.primaryGradientEnd).toFixed(2)})`);
  }
});
