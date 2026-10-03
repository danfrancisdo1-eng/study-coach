import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProviderMaterial } from './material-file-provider.ts';

test('waits for the provider to download a local file before returning it', async () => {
  let deliver;
  const pending = selectProviderMaterial(options => {
    assert.equal(options.copyToCacheDirectory, true);
    assert.equal(options.type, '*/*');
    return new Promise(resolve => { deliver = resolve; });
  });
  const asset = { name: 'Lecture.pdf', uri: 'file:///cache/lecture.pdf', size: 200 };
  deliver({ canceled: false, assets: [asset] });
  assert.deepEqual(await pending, asset);
});

test('cancellation returns no replacement material', async () => {
  assert.equal(await selectProviderMaterial(async () => ({ canceled: true })), null);
});

test('rejects empty, oversized, unsupported and unavailable cloud files', async () => {
  for (const asset of [
    { name: 'Empty.pdf', uri: 'file:///a', size: 0 },
    { name: 'Large.pdf', uri: 'file:///a', size: 12 * 1024 * 1024 + 1 },
    { name: 'Sheet.xlsx', uri: 'file:///a', size: 30 },
    { name: 'Photo.heic', uri: 'file:///a', size: 30 },
    { name: 'Unavailable.pdf', uri: '', size: 30 },
  ]) {
    await assert.rejects(selectProviderMaterial(async () => ({ canceled: false, assets: [asset] })));
  }
});

test('provider download failures remain retryable errors', async () => {
  await assert.rejects(selectProviderMaterial(async () => { throw new Error('Cloud download failed'); }), /Cloud download failed/);
  const asset = { name: 'Screenshot.png', uri: 'file:///cache/image.png', size: 200 };
  assert.deepEqual(await selectProviderMaterial(async () => ({ canceled: false, assets: [asset] })), asset);
});
