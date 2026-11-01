import { boolean, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// D-219: campus reps (migration 0007, additive). A rep hands out a code; a student who signs up with it is
// counted for that rep; RevenueCat's payment events for that student give the rep a share (default 50%) of
// what RapidRecall receives after Apple's fee. Reps see counts and totals only, never names or emails.
export const repsTable = pgTable("reps", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  school: text("school").notNull(),
  sharePercent: integer("share_percent").notNull().default(50),
  token: text("token").notNull().unique(), // the rep's private page link, long and random
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Which rep invited which account (first code wins).
export const repSignupsTable = pgTable("rep_signups", {
  ownerId: text("owner_id").primaryKey(),
  repId: text("rep_id").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per RevenueCat payment event of an invited account (id = RevenueCat's event id, so a resent event
// is ignored). Refunds are negative. SANDBOX rows (TestFlight) are kept but left out of every money total.
export const repPaymentsTable = pgTable("rep_payments", {
  id: text("id").primaryKey(),
  repId: text("rep_id").notNull(),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull(),
  productId: text("product_id"),
  priceCents: integer("price_cents").notNull(),
  netCents: integer("net_cents").notNull(),
  environment: text("environment").notNull().default("PRODUCTION"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  month: text("month").notNull(), // YYYY-MM, UTC
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rep_payments_rep_month").on(t.repId, t.month)]);

// Dan's "Mark paid": what was paid to a rep for a month.
export const repPayoutsTable = pgTable("rep_payouts", {
  repId: text("rep_id").notNull(),
  month: text("month").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.repId, t.month] })]);
