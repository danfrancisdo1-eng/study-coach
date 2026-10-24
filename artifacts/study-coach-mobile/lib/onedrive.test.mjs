// D-190: direct OneDrive. The list shows folders and readable files only; the token is kept and refreshed safely.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listUrl, searchUrl, itemUrl, parseItems, pickProblem, rowDetail, tokenFresh, toStored, parseStored,
  ownerName, downloadLink, graphProblem, isPhoto, ONEDRIVE_SCOPES, ONEDRIVE_DISCOVERY, READABLE_EXTENSIONS,
} from './onedrive.ts';
import { SUPPORTED_EXTENSIONS } from './material-file-provider.ts';

test('asks Microsoft for read-only access and works with personal and school accounts', () => {
  assert.deepEqual(ONEDRIVE_SCOPES, ['Files.Read', 'offline_access']);
  assert.ok(!ONEDRIVE_SCOPES.some((s) => /write/i.test(s)));
  assert.match(ONEDRIVE_DISCOVERY.authorizationEndpoint, /\/common\/oauth2\/v2\.0\/authorize$/);
});

test('list and search URLs', () => {
  assert.match(listUrl(), /\/me\/drive\/root\/children\?/);
  assert.match(listUrl('A1!B2'), /\/me\/drive\/items\/A1!B2\/children\?/);
  assert.match(listUrl('a/b'), /items\/a%2Fb\/children/);
  // OData quotes doubled, then URL-encoded; nothing can close the string early.
  const url = searchUrl(" Dan's notes ");
  assert.match(url, /search\(q='Dan''s%20notes'\)/);
  assert.match(itemUrl('X 1'), /\/me\/drive\/items\/X%201$/);
});

test('folders first, then readable files, A to Z; unreadable and odd items hidden', () => {
  const rows = parseItems({ value: [
    { id: '1', name: 'week 10.pdf', size: 2_000_000, file: {} },
    { id: '2', name: 'Budget.xlsx', size: 100, file: {} },
    { id: '3', name: 'Lectures', folder: { childCount: 12 } },
    { id: '4', name: 'week 2.pdf', size: 900, file: {} },
    { id: '5', name: 'Notebook', package: { type: 'oneNote' } },
    { id: '6', name: 'Archive', folder: { childCount: 1 } },
    { id: '7', name: 'Slides.PPTX', size: 5000, file: {} },
    { name: 'no id.pdf', file: {} },
    null,
  ] });
  assert.deepEqual(rows.map((r) => r.name), ['Archive', 'Lectures', 'Slides.PPTX', 'week 2.pdf', 'week 10.pdf']);
  assert.equal(rows[1].childCount, 12);
  assert.deepEqual(parseItems(null), []);
  assert.deepEqual(parseItems({ value: 'x' }), []);
});

test('a file that is too big or unreadable says why in one sentence', () => {
  assert.equal(pickProblem({ name: 'a.pdf', size: 1000, kind: 'file' }), null);
  assert.match(pickProblem({ name: 'big.pdf', size: 13 * 1024 * 1024, kind: 'file' }), /bigger than 12 MB/);
  assert.match(pickProblem({ name: 'old.doc', size: 10, kind: 'file' }), /can't be read/);
  assert.match(pickProblem({ name: 'Folder', size: 0, kind: 'folder' }), /Open the folder/);
  assert.ok(isPhoto('IMG_1.JPG'));
  assert.ok(!isPhoto('a.pdf'));
});

test('row details', () => {
  assert.equal(rowDetail({ kind: 'file', size: 2.4 * 1024 * 1024 }), '2.4 MB');
  assert.equal(rowDetail({ kind: 'file', size: 830 * 1024 }), '830 KB');
  assert.equal(rowDetail({ kind: 'file', size: 10 }), '1 KB');
  assert.equal(rowDetail({ kind: 'folder', childCount: 1 }), '1 item');
  assert.equal(rowDetail({ kind: 'folder', childCount: 12 }), '12 items');
});

test('tokens: fresh for at least a minute; the refresh token survives a reply without one; bad storage is ignored', () => {
  const now = 1_000_000;
  assert.ok(tokenFresh({ accessToken: 'a', expiresAt: now + 120_000 }, now));
  assert.ok(!tokenFresh({ accessToken: 'a', expiresAt: now + 30_000 }, now));
  assert.ok(!tokenFresh(null, now));
  const stored = toStored({ accessToken: 'new', expiresIn: 3600, issuedAt: 1000 }, 'old-refresh');
  assert.deepEqual(stored, { accessToken: 'new', refreshToken: 'old-refresh', expiresAt: 1000 * 1000 + 3600 * 1000 });
  assert.equal(toStored({ accessToken: 'n', refreshToken: 'r2', expiresIn: 60, issuedAt: 0 }, 'r1').refreshToken, 'r2');
  assert.deepEqual(parseStored(JSON.stringify(stored)), stored);
  assert.equal(parseStored('not json'), null);
  assert.equal(parseStored(JSON.stringify({ accessToken: 1 })), null);
  assert.equal(parseStored(null), null);
});

test('owner name, download link and plain errors', () => {
  assert.equal(ownerName({ owner: { user: { displayName: ' Dan Francis ' } } }), 'Dan Francis');
  assert.equal(ownerName({}), '');
  assert.equal(downloadLink({ '@microsoft.graph.downloadUrl': 'https://x.sharepoint.com/download?t=1' }), 'https://x.sharepoint.com/download?t=1');
  assert.equal(downloadLink({ '@microsoft.graph.downloadUrl': 'http://insecure' }), null);
  assert.equal(downloadLink({}), null);
  assert.ok(graphProblem(401).reconnect);
  assert.ok(!graphProblem(404).reconnect);
  assert.match(graphProblem(403).message, /school/);
  assert.match(graphProblem(500).message, /connection/);
});

test('OneDrive accepts exactly the file types the Files button accepts', () => {
  assert.deepEqual([...READABLE_EXTENSIONS].sort(), [...SUPPORTED_EXTENSIONS].sort());
});
