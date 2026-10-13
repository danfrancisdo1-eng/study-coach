// Premium state in Postgres (D-090, migration 0004): the account's plan and its daily AI use.
// Limits apply only with PREMIUM_LIMITS=on, so the Expo Go beta keeps working until the
// purchase flow ships; then Render's env is switched on.
import { eq, sql } from "drizzle-orm";
import { aiUsageTable, db, entitlementsTable } from "@workspace/db";
import { LIMITS, activeCourseIds, applyEvent, isPremium, ownerAccounts, type Entitlement, type Plan, type PlanLimits, type RevenueCatEvent } from "./premium";

export const enforced = (): boolean => process.env["PREMIUM_LIMITS"] === "on";

export type PlanInfo = {
  plan: Plan;
  source: "owner" | "revenuecat" | null;
  expiresAt: Date | null;
  productId: string | null;
  limits: PlanLimits;
};

export async function planFor(ownerId: string, now: Date = new Date()): Promise<PlanInfo> {
  if (ownerAccounts(process.env["OWNER_ACCOUNT_IDS"]).includes(ownerId)) {
    return { plan: "premium", source: "owner", expiresAt: null, productId: null, limits: LIMITS.premium };
  }
  const row = (await db.select().from(entitlementsTable).where(eq(entitlementsTable.ownerId, ownerId)).limit(1))[0];
  const premium = isPremium(row ? { plan: row.plan, expiresAt: row.expiresAt } : null, now);
  return {
    plan: premium ? "premium" : "free",
    source: row ? "revenuecat" : null,
    expiresAt: row?.expiresAt ?? null,
    productId: row?.productId ?? null,
    limits: LIMITS[premium ? "premium" : "free"],
  };
}

/** Courses the plan keeps active (all when limits are off). */
export function activeFor(courses: { id: string }[], info: PlanInfo): string[] {
  return activeCourseIds(courses, !enforced() || info.plan === "premium");
}

type Kind = "sets" | "messages";
const column = (kind: Kind) => sql.raw(kind === "sets" ? '"sets"' : '"messages"');
const expired = sql`"window_start" <= now() - interval '24 hours'`;

/**
 * Count one use of `kind` if the account is under `limit` in its rolling 24-hour window
 * (a window older than 24 hours starts again at zero). One statement, so two devices cannot
 * both take the last one. Returns false when the limit is reached.
 */
export async function consume(ownerId: string, kind: Kind, limit: number): Promise<boolean> {
  await db.insert(aiUsageTable).values({ ownerId }).onConflictDoNothing();
  const col = column(kind);
  const result = await db.execute(sql`
    update "ai_usage" set
      "sets" = case when ${expired} then 0 else "sets" end + ${kind === "sets" ? 1 : 0},
      "messages" = case when ${expired} then 0 else "messages" end + ${kind === "messages" ? 1 : 0},
      "window_start" = case when ${expired} then now() else "window_start" end,
      "updated_at" = now()
    where "owner_id" = ${ownerId} and (case when ${expired} then 0 else ${col} end) < ${limit}
    returning "owner_id"`);
  return result.rows.length > 0;
}

/** Give one use back (the AI call failed, or a later limit stopped the request). Never below zero. */
export async function refund(ownerId: string, kind: Kind): Promise<void> {
  const col = column(kind);
  await db.execute(sql`update "ai_usage" set ${col} = greatest(${col} - 1, 0), "updated_at" = now() where "owner_id" = ${ownerId}`);
}

export async function usageFor(ownerId: string): Promise<{ sets: number; messages: number; resetAt: string | null }> {
  const row = (await db.select().from(aiUsageTable).where(eq(aiUsageTable.ownerId, ownerId)).limit(1))[0];
  if (!row || row.windowStart.getTime() <= Date.now() - 24 * 60 * 60 * 1000) return { sets: 0, messages: 0, resetAt: null };
  return { sets: row.sets, messages: row.messages, resetAt: new Date(row.windowStart.getTime() + 24 * 60 * 60 * 1000).toISOString() };
}

async function currentEntitlement(ownerId: string): Promise<Entitlement | null> {
  const row = (await db.select().from(entitlementsTable).where(eq(entitlementsTable.ownerId, ownerId)).limit(1))[0];
  return row ? { plan: row.plan, expiresAt: row.expiresAt, productId: row.productId, lastEventAt: row.lastEventAt } : null;
}

async function save(ownerId: string, next: Entitlement): Promise<void> {
  const values = { plan: next.plan, expiresAt: next.expiresAt, productId: next.productId ?? null, lastEventAt: next.lastEventAt ?? null, source: "revenuecat", updatedAt: new Date() };
  await db.insert(entitlementsTable).values({ ownerId, ...values }).onConflictDoUpdate({ target: entitlementsTable.ownerId, set: values });
}

/** Apply one RevenueCat webhook event. Returns whether anything changed. */
export async function recordEvent(ownerId: string, event: RevenueCatEvent): Promise<boolean> {
  const next = applyEvent(await currentEntitlement(ownerId), event);
  if (!next) return false;
  await save(ownerId, next);
  return true;
}

/**
 * Ask RevenueCat for the account's current entitlement (after a purchase or Restore Purchases)
 * and store it. Without REVENUECAT_SECRET_KEY this is a no-op and the stored plan stands.
 */
export async function refreshFromRevenueCat(ownerId: string): Promise<void> {
  const key = process.env["REVENUECAT_SECRET_KEY"];
  if (!key) return;
  const base = process.env["REVENUECAT_API_BASE"] ?? "https://api.revenuecat.com";
  const response = await fetch(`${base}/v1/subscribers/${encodeURIComponent(ownerId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`RevenueCat responded ${response.status}`);
  const body = await response.json() as { subscriber?: { entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }> } };
  const premium = body.subscriber?.entitlements?.["premium"];
  const expiresAt = premium?.expires_date ? new Date(premium.expires_date) : null;
  const active = !!premium && (expiresAt === null || expiresAt.getTime() > Date.now());
  const current = await currentEntitlement(ownerId);
  await save(ownerId, {
    plan: active ? "premium" : "free",
    expiresAt: premium ? expiresAt : current?.expiresAt ?? null,
    productId: premium?.product_identifier ?? current?.productId ?? null,
    // A refresh is the latest truth; later webhooks still apply on top of it.
    lastEventAt: current?.lastEventAt ?? null,
  });
}
