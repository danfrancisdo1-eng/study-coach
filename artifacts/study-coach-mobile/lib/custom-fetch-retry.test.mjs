// D-208: the API client sends a request again once when its connection drops, for requests safe to repeat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { customFetch, shouldRetry } from '../../../lib/api-client-react/src/custom-fetch.ts';

const realFetch = globalThis.fetch;
const stub = (failures) => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push(init.method);
    if (calls.length <= failures) throw new TypeError('Network request failed');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
};
test.afterEach(() => { globalThis.fetch = realFetch; });

test('shouldRetry: only dropped connections on GET, HEAD, PUT, DELETE; never a cancelled one', () => {
  const dropped = new TypeError('Network request failed');
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) assert.equal(shouldRetry(method, dropped), true, method);
  assert.equal(shouldRetry('POST', dropped), false, 'a POST is never sent twice');
  assert.equal(shouldRetry('PATCH', dropped), false);
  assert.equal(shouldRetry('GET', new Error('other')), false);
  const aborted = new AbortController(); aborted.abort();
  assert.equal(shouldRetry('GET', dropped, aborted.signal), false);
  assert.equal(shouldRetry('GET', Object.assign(new TypeError('x'), { name: 'AbortError' })), false);
});

test('a PUT (saving an answer) whose connection drops once goes through on the retry', async () => {
  const calls = stub(1);
  assert.deepEqual(await customFetch('/api/x', { method: 'PUT', body: '{"a":1}' }), { ok: true });
  assert.deepEqual(calls, ['PUT', 'PUT']);
});

test('one retry only; a POST is not retried', async () => {
  let calls = stub(2);
  await assert.rejects(customFetch('/api/x'), TypeError);
  assert.equal(calls.length, 2);
  calls = stub(1);
  await assert.rejects(customFetch('/api/x', { method: 'POST', body: '{}' }), TypeError);
  assert.equal(calls.length, 1);
});
