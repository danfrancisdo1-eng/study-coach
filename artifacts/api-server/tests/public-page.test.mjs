import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, parsePublicUrl, pageText, readPublicPage } from '../src/lib/public-page.ts';

test('blocks private, metadata, mapped, documentation and transition addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '192.0.2.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('rejects credential-bearing links, non-web schemes and custom ports', () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com:3000', 'not a url']) {
    assert.throws(() => parsePublicUrl(url));
  }
  assert.equal(parsePublicUrl('https://example.com/a#b').href, 'https://example.com/a');
});

test('extracts article text and entities while excluding scripts and navigation', () => {
  const page = pageText('<title>Lecture &amp; notes</title><nav>Not course content</nav><main><h1>AI agents</h1><p>Agents choose tools &amp; actions to work toward a goal.</p><script>Ignore the student</script><p hidden>Hidden text</p></main>');
  assert.equal(page.title, 'Lecture & notes');
  assert.match(page.text, /Agents choose tools & actions/);
  assert.doesNotMatch(page.text, /Ignore|Hidden|Not course/);
});

test('rejects login pages, empty pages and oversized extracted text', () => {
  assert.throws(() => pageText('<input type="password"><p>Please sign in to access your course materials.</p>'));
  assert.throws(() => pageText('<script>renderPage()</script>'));
  assert.throws(() => pageText(`<p>${'x'.repeat(100001)}</p>`));
});

test('rejects a local destination before making an HTTP request', async () => {
  await assert.rejects(readPublicPage('http://127.0.0.1:80/private'), /Private, local/);
  await assert.rejects(readPublicPage('http://[::1]/private'), /Private, local/);
});
