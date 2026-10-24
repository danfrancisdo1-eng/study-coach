import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDER_CREDENTIALS, FOUNDER_QUOTE, FOUNDER_STORY } from './founder.ts';

test('the founder story names both certifications and never carries a credential ID (D-182)', () => {
  const all = [...FOUNDER_STORY, FOUNDER_QUOTE, ...FOUNDER_CREDENTIALS.map((c) => `${c.issuer} ${c.name} ${c.issued}`)].join(' ');
  assert.match(all, /NVIDIA/);
  assert.match(all, /Google Cloud/);
  assert.doesNotMatch(all, /qg9zh7fk|df46062296574c48be8f3d25802a2579|80865/i, 'no credential or series ID');
  assert.equal(FOUNDER_CREDENTIALS.length, 2);
});

test('the claims match the certificates: three days apart, September 2026', () => {
  const days = FOUNDER_CREDENTIALS.map((c) => new Date(c.issued).getTime());
  assert.equal(Math.round(Math.abs(days[1] - days[0]) / 86_400_000), 2, 'Sep 28 and Sep 30: within three days');
  assert.match(FOUNDER_QUOTE, /three days/);
  assert.ok(FOUNDER_QUOTE.length <= 140, 'one or two lines on the paywall');
});
