import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type HomeChatRole = "user" | "assistant";
export type HomeChatAction =
  | { type: "create_course"; courseId: string; name: string }
  | { type: "start_session"; sessionId: string; courseId: string; topic: string };
export type HomeChatMessage = {
  id: string;
  role: HomeChatRole;
  content: string;
  at: string;
  /** Actions the coach carried out while answering (assistant messages only). */
  actions?: HomeChatAction[];
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
