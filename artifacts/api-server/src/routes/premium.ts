// Premium routes (D-090). GET /premium: the account's plan, limits, today's use and which
// courses are active or read-only. POST /premium/refresh: re-check with RevenueCat after a
// purchase or Restore Purchases. POST /premium/revenuecat: RevenueCat's webhook, authenticated
// by the exact Authorization value configured in RevenueCat (REVENUECAT_WEBHOOK_AUTH); no
// Clerk session. The app user id in RevenueCat is the Clerk user id.
import { Router, type IRouter, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, studyStatesTable } from "@workspace/db";
import { requireStudyAuth } from "./study";
import { activeFor, bindExamPasses, enforced, examPassesOf, planFor, recordEvent, recordExamPass, refreshFromRevenueCat, usageFor } from "../lib/premium-store";
import { isExamPass } from "../lib/premium";

const router: IRouter = Router();

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

async function coursesOf(ownerId: string): Promise<{ id: string; kind?: unknown }[]> {
  const state = (await db.select({ state: studyStatesTable.state }).from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1))[0]?.state as { courses?: unknown } | undefined;
  return Array.isArray(state?.courses) ? state.courses.filter((c): c is { id: string; kind?: unknown } => !!c && typeof (c as { id?: unknown }).id === "string") : [];
}

/** D-156: binds unbound passes to the exam the app names, or to the account's only certification exam. */
async function bindPasses(ownerId: string, courseId: string | null): Promise<void> {
  const exams = (await coursesOf(ownerId)).filter((c) => c.kind === "exam");
  const target = courseId && exams.some((c) => c.id === courseId) ? courseId : exams.length === 1 ? exams[0]!.id : null;
  if (target) await bindExamPasses(ownerId, target);
}

async function status(ownerId: string) {
  const info = await planFor(ownerId);
  const courses = await coursesOf(ownerId);
  const active = activeFor(courses, info);
  return {
    enforced: enforced(),
    plan: info.plan,
    source: info.source,
    expiresAt: info.expiresAt ? info.expiresAt.toISOString() : null,
    productId: info.productId,
    limits: info.limits,
    usage: await usageFor(ownerId),
    activeCourseIds: active,
    readOnlyCourseIds: courses.map((c) => c.id).filter((id) => !active.includes(id)),
    examPasses: await examPassesOf(ownerId),
  };
}

router.get("/premium", requireStudyAuth, async (req, res): Promise<void> => {
  res.json(await status(owner(req)));
});

router.post("/premium/refresh", requireStudyAuth, async (req, res): Promise<void> => {
  const ownerId = owner(req);
  try {
    await refreshFromRevenueCat(ownerId);
    const courseId = typeof (req.body as { courseId?: unknown } | undefined)?.courseId === "string" ? (req.body as { courseId: string }).courseId : null;
    await bindPasses(ownerId, courseId);
  } catch (error) {
    req.log.error({ error: error instanceof Error ? error.message.slice(0, 300) : "Unknown error" }, "Premium refresh failed");
    res.status(502).json({ error: "RapidRecall AI could not check your purchase just now. Try Restore Purchases again in a moment." });
    return;
  }
  res.json(await status(ownerId));
});

function authorized(header: string | undefined): boolean {
  const expected = process.env["REVENUECAT_WEBHOOK_AUTH"];
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post("/premium/revenuecat", async (req, res): Promise<void> => {
  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const event = (req.body as { event?: Record<string, unknown> } | undefined)?.event;
  const appUserId = typeof event?.["app_user_id"] === "string" ? event["app_user_id"] : null;
  if (!event || !appUserId || typeof event["type"] !== "string") {
    res.status(400).json({ error: "Expected a RevenueCat event with app_user_id and type." });
    return;
  }
  // D-156: an exam pass is its own row for one exam, never the account's Premium.
  if (isExamPass(typeof event["product_id"] === "string" ? event["product_id"] : null)) {
    const at = typeof event["purchased_at_ms"] === "number" ? event["purchased_at_ms"] : typeof event["event_timestamp_ms"] === "number" ? event["event_timestamp_ms"] : Date.now();
    const id = typeof event["transaction_id"] === "string" ? event["transaction_id"] : typeof event["id"] === "string" ? event["id"] : `${appUserId}:${at}`;
    const recorded = event["type"] === "NON_RENEWING_PURCHASE" || event["type"] === "INITIAL_PURCHASE"
      ? await recordExamPass(appUserId, { id, productId: event["product_id"] as string, purchasedAt: new Date(at) }) : false;
    if (recorded) await bindPasses(appUserId, null);
    req.log.info({ type: event["type"], recorded }, "RevenueCat exam pass event");
    res.json({ ok: true, changed: recorded });
    return;
  }
  const changed = await recordEvent(appUserId, event as Parameters<typeof recordEvent>[1]);
  req.log.info({ type: event["type"], changed }, "RevenueCat event");
  res.json({ ok: true, changed });
});

export default router;
