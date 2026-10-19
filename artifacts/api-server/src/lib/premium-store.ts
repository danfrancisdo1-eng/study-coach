// Premium state in Postgres (D-090, migration 0004): the account's plan and its daily AI use.
// Limits apply only with PREMIUM_LIMITS=on, so the Expo Go beta keeps working until the
// purchase flow ships; then Render's env is switched on.
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { aiUsageTable, db, entitlementsTable, examPassesTable, studySessionsTable } from "@workspace/db";
import { EXAM_PASS_DAYS, LIMITS, activeCourseIds, applyEvent, isActivePlan, isExamPass, ownerAccounts, type Entitlement, type Plan, type PlanLimits, type RevenueCatEvent } from "./premium";

export const enforced = (): boolean => process.env["PREMIUM_LIMITS"] === "on";

export type PlanInfo = {
  plan: Plan;
  source: "owner" | "revenuecat" | "exam_pass" | null;
  expiresAt: Date | null;
  productId: string | null;
  limits: PlanLimits;
};

/** The account's plan; with a course, an exam pass for that course counts as Premium there (D-156). */
export async function planFor(ownerId: string, courseIdOrNow?: string | null | Date, maybeNow?: Date): Promise<PlanInfo> {
  const courseId = typeof courseIdOrNow === "string" ? courseIdOrNow : null;
  const now = courseIdOrNow instanceof Date ? courseIdOrNow : maybeNow ?? new Date();
  if (ownerAccounts(process.env["OWNER_ACCOUNT_IDS"]).includes(ownerId)) {
    return { plan: "premium", source: "owner", expiresAt: null, productId: null, limits: LIMITS.premium };
  }
  const row = (await db.select().from(entitlementsTable).where(eq(entitlementsTable.ownerId, ownerId)).limit(1))[0];
  // D-155: the free week (trial) or Premium while it lasts; otherwise free.
  const plan: Plan = row && isActivePlan({ plan: row.plan, expiresAt: row.expiresAt }, now) ? row.plan : "free";
  if (plan === "free" && courseId) {
    const pass = await examPassFor(ownerId, courseId, now);
    if (pass) return { plan: "premium", source: "exam_pass", expiresAt: pass.expiresAt, productId: pass.productId, limits: LIMITS.premium };
  }
  return {
    plan,
    source: row ? "revenuecat" : null,
    expiresAt: row?.expiresAt ?? null,
    productId: row?.productId ?? null,
    limits: LIMITS[plan],
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
  const body = await response.json() as { subscriber?: { entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string; purchase_date?: string }>; subscriptions?: Record<string, { period_type?: string }>; non_subscriptions?: Record<string, { id?: string; purchase_date?: string }[]> } };
  // D-156: exam passes are their own rows (one exam each), never the account's Premium.
  for (const [productId, purchases] of Object.entries(body.subscriber?.non_subscriptions ?? {})) {
    if (!isExamPass(productId)) continue;
    for (const p of purchases) if (p.id && p.purchase_date) await recordExamPass(ownerId, { id: p.id, productId, purchasedAt: new Date(p.purchase_date) });
  }
  const entitled = body.subscriber?.entitlements?.["premium"];
  const premium = entitled && !isExamPass(entitled.product_identifier) ? entitled : undefined;
  // D-153: the exam pass (non-renewing) has no expiry at RevenueCat: it lasts EXAM_PASS_DAYS from the purchase.
  const passEnds = premium && !premium.expires_date && isExamPass(premium.product_identifier) && premium.purchase_date
    ? new Date(new Date(premium.purchase_date).getTime() + EXAM_PASS_DAYS * 86_400_000) : null;
  const expiresAt = premium?.expires_date ? new Date(premium.expires_date) : passEnds;
  const active = !!premium && (expiresAt === null || expiresAt.getTime() > Date.now());
  const current = await currentEntitlement(ownerId);
  await save(ownerId, {
    // D-155: during Apple's free week RevenueCat marks the subscription's period as a trial.
    plan: active ? (premium?.product_identifier && body.subscriber?.subscriptions?.[premium.product_identifier]?.period_type?.toLowerCase() === "trial" ? "trial" : "premium") : "free",
    expiresAt: premium ? expiresAt : current?.expiresAt ?? null,
    productId: premium?.product_identifier ?? current?.productId ?? null,
    // A refresh is the latest truth; later webhooks still apply on top of it.
    lastEventAt: current?.lastEventAt ?? null,
  });
}

/**
 * D-153: questions an exam course has had so far (every set and retest written for it), for the
 * free 50. Counts what was served, answered or not, so starting sets and leaving them does not reset it.
 */
export async function examQuestionsServed(ownerId: string, courseId: string): Promise<number> {
  const rows = await db.select({ session: studySessionsTable.session }).from(studySessionsTable)
    .where(and(eq(studySessionsTable.ownerId, ownerId), eq(studySessionsTable.courseId, courseId)));
  let served = 0;
  for (const { session } of rows) {
    const s = session as { quiz?: { questions?: unknown[]; expectedCount?: number; grade?: unknown } | null; attempts?: { questions?: unknown[] }[] };
    const attempts = Array.isArray(s.attempts) ? s.attempts : [];
    served += attempts.reduce((n, a) => n + (Array.isArray(a.questions) ? a.questions.length : 0), 0);
    // The set in progress (not yet graded into attempts): what it will hold.
    if (s.quiz && !s.quiz.grade) served += Math.max(Array.isArray(s.quiz.questions) ? s.quiz.questions.length : 0, s.quiz.expectedCount ?? 0);
  }
  return served;
}

// D-156 (Dan: "Exam pass covers one exam"): each pass is its own row; it unlocks one exam (course) for
// EXAM_PASS_DAYS. A pass arrives (webhook or refresh) unbound; the app names the exam it was bought from,
// or, when the account has exactly one certification exam, it binds to that one.

/** Records a pass (once per store transaction); returns whether it was new. */
export async function recordExamPass(ownerId: string, pass: { id: string; productId: string; purchasedAt: Date }): Promise<boolean> {
  const expiresAt = new Date(pass.purchasedAt.getTime() + EXAM_PASS_DAYS * 86_400_000);
  const rows = await db.insert(examPassesTable).values({ id: pass.id, ownerId, productId: pass.productId, purchasedAt: pass.purchasedAt, expiresAt })
    .onConflictDoNothing().returning({ id: examPassesTable.id });
  return rows.length > 0;
}

/** Binds the account's unbound, unexpired passes to an exam. */
export async function bindExamPasses(ownerId: string, courseId: string, now: Date = new Date()): Promise<number> {
  const rows = await db.update(examPassesTable).set({ courseId })
    .where(and(eq(examPassesTable.ownerId, ownerId), isNull(examPassesTable.courseId), gt(examPassesTable.expiresAt, now)))
    .returning({ id: examPassesTable.id });
  return rows.length;
}

/** The exam's active pass, if any (the one that ends last). */
export async function examPassFor(ownerId: string, courseId: string, now: Date = new Date()): Promise<{ expiresAt: Date; productId: string } | null> {
  const row = (await db.select().from(examPassesTable)
    .where(and(eq(examPassesTable.ownerId, ownerId), eq(examPassesTable.courseId, courseId), gt(examPassesTable.expiresAt, now)))
    .orderBy(desc(examPassesTable.expiresAt)).limit(1))[0];
  return row ? { expiresAt: row.expiresAt, productId: row.productId } : null;
}

/** Every active pass of the account (for the status: which exams are unlocked until when). */
export async function examPassesOf(ownerId: string, now: Date = new Date()): Promise<{ courseId: string | null; expiresAt: string }[]> {
  const rows = await db.select().from(examPassesTable).where(and(eq(examPassesTable.ownerId, ownerId), gt(examPassesTable.expiresAt, now)));
  return rows.map((r) => ({ courseId: r.courseId, expiresAt: r.expiresAt.toISOString() }));
}
