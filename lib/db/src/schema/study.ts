import { jsonb, pgTable, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const studyStatesTable = pgTable("study_states", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("study_states_owner_id_unique").on(table.ownerId)]);

export const studySessionsTable = pgTable("study_sessions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  courseId: text("course_id").notNull(),
  topic: text("topic").notNull(),
  session: jsonb("session").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});