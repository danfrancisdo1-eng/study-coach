import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, reviewHtml } from './review-html.ts';

const sheet = {
  title: 'AB-731 Quick Review', subtitle: '45 minutes • 700/1000 to pass', courseName: 'AB-731', generatedAt: '2026-10-15T12:00:00.000Z',
  facts: [{ label: 'Duration', value: '45 minutes' }], audience: 'Business leaders', priorityNote: 'Two domains ≈ 75%.',
  glance: [{ name: 'Business value <b>', weight: '35–40%', focus: 'GenAI' }],
  sections: [{ name: 'Cloud <script>alert(1)</script>', weight: '35–40%', analogy: 'A car', subsections: [{ title: 'Foundations', items: [{ term: 'Grounding', detail: 'Trusted data.' }] }],
    contrasts: [{ pair: 'Model vs Cloud Armor', trick: 'MODEL protects the model' }], triggers: [{ whenYouSee: 'cache', think: 'Memorystore' }],
    misses: [{ question: 'What is PaaS?', answer: 'Platform as a service', giveaway: 'managed platform' }] }],
  tips: ['Flag and return'], decoder: [{ cue: 'CACHE', answer: 'Memorystore' }], sources: [{ title: 'Study guide', url: 'https://learn.microsoft.com/x' }],
};

test('the v2 PDF page: Grok-style blocks, every string escaped (D-106)', () => {
  assert.equal(escapeHtml('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  const html = reviewHtml(sheet);
  assert.ok(!html.includes('<script>alert'));
  for (const part of ['Skills at a Glance', 'Domain 1: Cloud &lt;script&gt;', '<b>Grounding:</b>', 'Remember it', 'When you see', 'The giveaway: managed platform', 'Exam Tips &amp; Common Pitfalls', 'Your decoder', '<b>CACHE</b> → Memorystore', 'Sources', 'Oct 2026']) assert.ok(html.includes(part), part);
  assert.ok(html.includes('Business value &lt;b&gt;'));
});

test('a college course without facts or glance omits those blocks', () => {
  const html = reviewHtml({ ...sheet, facts: [], glance: [], sources: [], tips: [], decoder: [] });
  for (const part of ['Skills at a Glance', 'Exam Tips', 'Your decoder', '<h4>Sources']) assert.ok(!html.includes(part), part);
});
