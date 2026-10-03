import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type LectureSegment = { start: number; end: number; text: string };
export type LectureStatus = "recorded" | "transcribed" | "reviewed";

// One row per recorded/imported lecture. Audio never leaves the student's device except
// for transcription; only metadata and the (student-corrected) transcript are stored.
// Kept out of study_states because transcripts would exceed that record's 900 KB cap.
export const lecturesTable = pgTable("lectures", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  courseId: text("course_id").notNull(),
  title: text("title").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  status: text("status").$type<LectureStatus>().notNull().default("recorded"),
  segments: jsonb("segments").$type<LectureSegment[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("lectures_owner_course_idx").on(table.ownerId, table.courseId)]);
