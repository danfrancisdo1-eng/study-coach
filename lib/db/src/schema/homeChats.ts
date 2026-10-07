import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type HomeChatRole = "user" | "assistant";
export type HomeChatAction =
  | { type: "create_course"; courseId: string; name: string; courseKind?: "course" | "exam" }
  | { type: "start_quiz"; sessionId: string; courseId: string; topic: string; kind: "practice" | "exam"; count: number }
  | { type: "start_flashcards"; sessionId: string; courseId: string; topic: string; count: number }
  | { type: "start_session"; sessionId: string; courseId: string; topic: string };
export type HomeChatMessage = {
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
};

// One row per account: the chat-first home conversation (SPEC §7). Kept out of
// study_states so a long conversation never pushes that record past its size cap.
export const homeChatsTable = pgTable("home_chats", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  messages: jsonb("messages").$type<HomeChatMessage[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("home_chats_owner_id_unique").on(table.ownerId)]);
