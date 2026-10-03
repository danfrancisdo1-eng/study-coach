import { defineConfig } from "drizzle-kit";
import path from "path";

// `drizzle-kit generate` (writes SQL to ./migrations) needs no database.
// `push` needs DATABASE_URL; never run it against the shared database without a
// written migration plan and the owner's OK (CLAUDE.md section 5).
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: "./migrations", // relative to lib/db, where the db scripts run
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
