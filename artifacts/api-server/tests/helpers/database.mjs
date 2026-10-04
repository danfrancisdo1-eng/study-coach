// In-memory Postgres (PGlite) served over the Postgres wire protocol, with the
// project's migrations (lib/db/migrations) applied in journal order. Lets the built
// server run end-to-end with a real DATABASE_URL and no external database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { serverDir } from './server.mjs';

const migrationsDir = path.resolve(serverDir, '..', '..', 'lib', 'db', 'migrations');

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function startDatabase(t) {
  const db = await PGlite.create();
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
  for (const entry of journal.entries) {
    const sql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.exec(statement);
    }
  }
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  t.after(async () => {
    await server.stop();
    await db.close();
  });
  return { url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, db };
}
