import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// D-090: who has Premium and until when. No row = free. Updated from RevenueCat's
// notifications (newest event wins) and by the on-demand refresh; owner accounts come
// from server config, not from this table.
export const entitlementsTable = pgTable("entitlements", {
  ownerId: text("owner_id").primaryKey(),
  plan: text("plan").$type<"free" | "trial" | "premium">().notNull().default("free"), // trial: the free week (D-155); text, no migration
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  productId: text("product_id"),
  source: text("source").notNull().default("revenuecat"),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// D-090: daily AI use per account, a rolling 24-hour window like the lecture quota.
export const aiUsageTable = pgTable("ai_usage", {
  ownerId: text("owner_id").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  sets: integer("sets").notNull().default(0),
  messages: integer("messages").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// D-156: each exam pass (a one-time Apple purchase, 60 days) and the one exam it unlocks. id is the
// store transaction id; course_id stays null until the app says which exam it was bought for.
export const examPassesTable = pgTable("exam_passes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  courseId: text("course_id"),
  productId: text("product_id").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("exam_passes_owner").on(t.ownerId)]);
