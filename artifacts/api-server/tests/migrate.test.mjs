// On-boot migrator (D-039): a fresh database gets every migration; a database migrated by
// hand before the migrator existed is recognized and only gets the new ones; a second run
// changes nothing; a failing migration rolls back and records nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { applyMigrations, HAND_APPLIED, readJournal, statementsOf } from '../../../lib/db/src/migrate.ts';
import { serverDir } from './helpers/server.mjs';

const migrationsDir = path.resolve(serverDir, '..', '..', 'lib', 'db', 'migrations');

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

async function emptyDatabase(t) {
  const db = await PGlite.create();
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  t.after(async () => { await server.stop(); await db.close(); });
  return { db, url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` };
}
const tables = async (db) => (await db.query("select tablename from pg_tables where schemaname='public' order by 1")).rows.map((r) => r.tablename);
const applied = async (db) => (await db.query('select tag from schema_migrations order by tag')).rows.map((r) => r.tag);

test('a fresh database gets every migration, once', async (t) => {
  const { db, url } = await emptyDatabase(t);
  const log = [];
  const first = await applyMigrations({ connectionString: url, migrationsDir, log: (m) => log.push(m) });
  const journalTags = readJournal(migrationsDir).map((e) => e.tag);
  assert.deepEqual(first.applied, journalTags);
  assert.equal(first.alreadyApplied, 0);
  assert.deepEqual(await applied(db), [...journalTags].sort());
  assert.ok((await tables(db)).includes('home_chats'));
  assert.ok((await db.query("select column_name from information_schema.columns where table_name='home_chats'")).rows.some((r) => r.column_name === 'course_id'), '0003 applied');
  assert.ok(!log.some((m) => m.includes('baseline recorded')), 'no hand-applied baseline on a fresh database');
  const second = await applyMigrations({ connectionString: url, migrationsDir });
  assert.deepEqual(second.applied, []);
  assert.equal(second.alreadyApplied, journalTags.length);
});

test('a database migrated by hand is recognized; only the new migrations run', async (t) => {
  const { db, url } = await emptyDatabase(t);
  // Production before the migrator: 0000-0002 run by hand, no schema_migrations table.
  for (const tag of HAND_APPLIED) for (const statement of statementsOf(readFileSync(path.join(migrationsDir, `${tag}.sql`), 'utf8'))) await db.exec(statement);
  assert.ok(!(await tables(db)).includes('schema_migrations'));
  const log = [];
  const result = await applyMigrations({ connectionString: url, migrationsDir, log: (m) => log.push(m) });
  assert.ok(log.some((m) => m.includes('baseline recorded (3 hand-applied)')));
  assert.deepEqual(result.applied, readJournal(migrationsDir).map((e) => e.tag).filter((tag) => !HAND_APPLIED.includes(tag)));
  assert.equal(result.alreadyApplied, HAND_APPLIED.length);
  const indexes = (await db.query("select indexname from pg_indexes where tablename='home_chats' order by 1")).rows.map((r) => r.indexname);
  assert.deepEqual(indexes, ['home_chats_owner_course_unique', 'home_chats_owner_general_unique', 'home_chats_pkey'], 'the old per-owner index is gone, the two partial ones exist');
});

test('a failing migration rolls back and records nothing; the server would refuse to start', async (t) => {
  const { db, url } = await emptyDatabase(t);
  const dir = mkdtempSync(path.join(tmpdir(), 'migrations-'));
  mkdirSync(path.join(dir, 'meta'));
  writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify({ entries: [
    { idx: 0, tag: '0000_good', when: 1 },
    { idx: 1, tag: '0001_bad', when: 2 },
  ] }));
  writeFileSync(path.join(dir, '0000_good.sql'), 'CREATE TABLE good (id int);');
  writeFileSync(path.join(dir, '0001_bad.sql'), 'CREATE TABLE half (id int);\n--> statement-breakpoint\nSELECT * FROM table_that_does_not_exist;');
  await assert.rejects(() => applyMigrations({ connectionString: url, migrationsDir: dir }), /Migration 0001_bad failed and was rolled back/);
  assert.deepEqual(await applied(db), ['0000_good'], 'the good one stays applied, the bad one is not recorded');
  const names = await tables(db);
  assert.ok(names.includes('good'));
  assert.ok(!names.includes('half'), 'the partial statement of the failed migration was rolled back');
});
