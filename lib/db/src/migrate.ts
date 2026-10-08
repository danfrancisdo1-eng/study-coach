// On-boot migrator (D-039): the server applies pending migrations from lib/db/migrations
// before it starts listening. Applied tags live in schema_migrations. Each migration runs
// in its own transaction; a failure rolls it back and throws, so the server refuses to
// start and the previous deploy keeps serving. Plain pg, no drizzle, so tests can load it
// directly (Node strips the types).
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/** Migrations that were run by hand on the production database before this migrator existed. */
export const HAND_APPLIED = ["0000_baseline", "0001_create_lectures", "0002_create_home_chats"];

export interface MigrateOptions {
  connectionString: string;
  migrationsDir: string;
  log?: (message: string) => void;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

type JournalEntry = { idx: number; tag: string; when: number };

export function readJournal(migrationsDir: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

export function statementsOf(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
}

export async function applyMigrations({ connectionString, migrationsDir, log = () => {} }: MigrateOptions): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    // Only one process migrates at a time (restarts, a second instance): a session-level advisory lock.
    await client.query("SELECT pg_advisory_lock(727001)");
    const known = new Set((await client.query<{ tag: string }>("SELECT tag FROM schema_migrations")).rows.map((r) => r.tag));
    if (known.size === 0) {
      // A database migrated by hand before the migrator existed: its tables are there, so the
      // hand-applied migrations count as done. A fresh database has no tables and runs them all.
      const existing = await client.query<{ ok: string | null }>("SELECT to_regclass('public.home_chats')::text AS ok");
      if (existing.rows[0]?.ok) {
        for (const tag of HAND_APPLIED) {
          await client.query("INSERT INTO schema_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING", [tag]);
          known.add(tag);
        }
        log(`migrations: baseline recorded (${HAND_APPLIED.length} hand-applied)`);
      }
    }
    const applied: string[] = [];
    let alreadyApplied = 0;
    for (const entry of readJournal(migrationsDir)) {
      if (known.has(entry.tag)) { alreadyApplied += 1; continue; }
      const sql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of statementsOf(sql)) await client.query(statement);
        await client.query("INSERT INTO schema_migrations (tag) VALUES ($1)", [entry.tag]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${entry.tag} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
      }
      applied.push(entry.tag);
      log(`migrations: applied ${entry.tag}`);
    }
    await client.query("SELECT pg_advisory_unlock(727001)");
    return { applied, alreadyApplied };
  } finally {
    await client.end();
  }
}
