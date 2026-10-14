import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, reviewHtml } from './review-html.ts';

test('the PDF page escapes every piece of text (D-101)', () => {
  assert.equal(escapeHtml('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  const html = reviewHtml({ title: 'AZ-900: review sheet', courseName: 'AZ-900', generatedAt: '2026-10-14T12:00:00.000Z', sections: [
    { name: 'Cloud <script>alert(1)</script>', points: ['Elasticity'], tricks: ['IaaS: I manage the OS'], misses: [{ question: 'What is PaaS?', answer: 'Platform as a service' }] },
    { name: 'Governance', points: ['Policy vs RBAC'], tricks: [], misses: [] },
  ] });
  assert.ok(!html.includes('<script>alert'));
  assert.match(html, /1\. Cloud &lt;script&gt;/);
  assert.match(html, /2\. Governance/);
  assert.match(html, /Answer: Platform as a service/);
  assert.match(html, /Oct 14, 2026/);
  assert.equal((html.match(/You missed these/g) ?? []).length, 1, 'no empty misses box');
});
