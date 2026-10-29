import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type HomeChatRole = "user" | "assistant";
export type HomeChatAction =
  | { type: "create_course"; courseId: string; name: string; courseKind?: "course" | "exam" }
  | { type: "start_quiz"; sessionId: string; courseId: string; topic: string; kind: "practice" | "exam"; count: number }
  | { type: "start_flashcards"; sessionId: string; courseId: string; topic: string; count: number }
  | { type: "update_memory_sheet"; courseId: string; rows: { id: string; term: string; trick: string; whenYouSee: string; think: string }[] }
  | { type: "update_course_notes" | "undo_course_notes"; courseId: string; summary: string }
  | { type: "fix_upload_notes"; courseId: string; name: string; summary: string }
  | { type: "start_session"; sessionId: string; courseId: string; topic: string }
  | { type: "lookup_exam_guide"; courseId: string; found: boolean; sections: number }
  | { type: "web_search"; courseId: string; query: string; found: boolean };
export type HomeChatMessage = {
  /** D-046: the student reported this coach reply. */
  reported?: { reason: "wrong" | "harmful" | "other"; note?: string; at: string };
  id: string;
  role: HomeChatRole;
  content: string;
  at: string;
  /** Actions the coach carried out while answering (assistant messages only). */
  actions?: HomeChatAction[];
  /** Tap-to-reply chips under an assistant message. */
  suggestions?: string[];
  /** App-written greeting that opens a new study session (SPEC §7: "resume where you left off"). */
  sessionStart?: boolean;
  /** D-203: sent by the app for the student ("Go over my misses"); kept for the coach, not drawn. */
  hidden?: boolean;
  /** D-203: while the coach goes over a graded set's misses: the set, the misses in order, and the one this reply teaches (0 = none). */
  lesson?: { sessionId: string; order: string[]; miss: number };
  /** D-216: this reply first teaches a miss that has a memory-hack picture (GET /study/sessions/{sessionId}/pictures/{questionId}). */
  picture?: { sessionId: string; questionId: string };
};

// One row per account: the chat-first home conversation (SPEC §7). Kept out of
// study_states so a long conversation never pushes that record past its size cap.
// One thread per course or exam (D-038); course_id null is the account's general thread.
export const homeChatsTable = pgTable("home_chats", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  courseId: text("course_id"),
  messages: jsonb("messages").$type<HomeChatMessage[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("home_chats_owner_general_unique").on(table.ownerId).where(sql`${table.courseId} is null`),
  uniqueIndex("home_chats_owner_course_unique").on(table.ownerId, table.courseId).where(sql`${table.courseId} is not null`),
]);
