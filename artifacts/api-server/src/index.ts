import path from "node:path";
import { applyMigrations } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Pending migrations run before the server listens (D-039). The bundle lives in
// artifacts/api-server/dist, so lib/db/migrations is three levels up, in the image and in
// the repo alike. A failed migration rolls back and exits, so a bad deploy never serves.
const migrationsDir = process.env["DB_MIGRATIONS_DIR"] ?? path.resolve(globalThis.__dirname ?? ".", "../../../lib/db/migrations");

async function main(): Promise<void> {
  if (process.env["SKIP_MIGRATIONS"] === "1") {
    // Tests that run the server without a database. Never set in production.
    logger.warn("SKIP_MIGRATIONS=1: pending migrations were not checked");
  } else {
    const result = await applyMigrations({ connectionString: process.env["DATABASE_URL"] ?? "", migrationsDir, log: (message) => logger.info(message) });
    logger.info({ applied: result.applied, alreadyApplied: result.alreadyApplied }, "Migrations checked");
  }
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

main().catch((err: unknown) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Startup failed; not listening");
  process.exit(1);
});
