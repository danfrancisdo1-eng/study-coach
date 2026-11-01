// Campus reps in Postgres (D-219, migration 0007). Small tables at beta scale, so the reports are put
// together in memory from a few plain reads. Reps see counts and money only, never who.
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, entitlementsTable, repPaymentsTable, repPayoutsTable, repSignupsTable, repsTable, studySessionsTable } from "@workspace/db";
import { firstName, generateCode, isLive, monthOf, monthsBetween, normalizeCode, paymentFromEvent, shareCents, takehomeFrom } from "./reps";

export type Rep = typeof repsTable.$inferSelect;

export type RepRow = {
  id: string; name: string; school: string; code: string; sharePercent: number; active: boolean;
  signups: number; active7d: number; paying: number; netCents: number; shareCents: number; paid: boolean; link: string;
};

export type RepsReport = {
  month: string;
  months: string[];
  totals: { signups: number; paying: number; netCents: number; owedCents: number };
  reps: RepRow[];
};

export async function repByCode(code: string): Promise<Rep | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return (await db.select().from(repsTable).where(and(eq(repsTable.code, normalized), eq(repsTable.active, true))).limit(1))[0] ?? null;
}

export async function repByToken(token: string): Promise<Rep | null> {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(token)) return null;
  return (await db.select().from(repsTable).where(eq(repsTable.token, token)).limit(1))[0] ?? null;
}

export type ClaimResult =
  | { ok: true; rep: Rep }
  | { ok: false; status: 404 | 409; error: string };

/** Ties the account to the rep whose code it is. First code wins; the same code again is fine. */
export async function claimCode(ownerId: string, code: string): Promise<ClaimResult> {
  const rep = await repByCode(code);
  if (!rep) return { ok: false, status: 404, error: "We don't know that code. Check it with your campus rep." };
  await db.insert(repSignupsTable).values({ ownerId, repId: rep.id, code: rep.code }).onConflictDoNothing();
  const row = (await db.select().from(repSignupsTable).where(eq(repSignupsTable.ownerId, ownerId)).limit(1))[0];
  if (row && row.repId !== rep.id) return { ok: false, status: 409, error: "Your account already has a campus rep's code." };
  return { ok: true, rep };
}

/**
 * D-219: called from the RevenueCat webhook after its own handling. Records a payment for an invited
 * account (once per event id). Never throws: the webhook's answer must not depend on rep bookkeeping.
 */
export async function recordRepPayment(appUserId: string, event: Record<string, unknown>, log: { info: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void }): Promise<boolean> {
  try {
    const signup = (await db.select().from(repSignupsTable).where(eq(repSignupsTable.ownerId, appUserId)).limit(1))[0];
    if (!signup) return false;
    const payment = paymentFromEvent(event, takehomeFrom(process.env));
    if (!payment) return false;
    const id = typeof event["id"] === "string" && event["id"] ? event["id"] : `${appUserId}:${payment.type}:${payment.occurredAt.getTime()}`;
    const rows = await db.insert(repPaymentsTable).values({
      id, repId: signup.repId, ownerId: appUserId, type: payment.type, productId: payment.productId,
      priceCents: payment.priceCents, netCents: payment.netCents, environment: payment.environment,
      occurredAt: payment.occurredAt, month: monthOf(payment.occurredAt),
    }).onConflictDoNothing().returning({ id: repPaymentsTable.id });
    log.info({ repId: signup.repId, type: payment.type, environment: payment.environment, recorded: rows.length > 0 }, "Campus rep payment");
    return rows.length > 0;
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message.slice(0, 300) : "Unknown error" }, "Campus rep payment not recorded");
    return false;
  }
}

/** Accounts with Premium right now (not the free week). */
async function payingOwners(ownerIds: string[], now: Date): Promise<Set<string>> {
  if (!ownerIds.length) return new Set();
  const rows = await db.select({ ownerId: entitlementsTable.ownerId, plan: entitlementsTable.plan, expiresAt: entitlementsTable.expiresAt })
    .from(entitlementsTable).where(inArray(entitlementsTable.ownerId, ownerIds));
  return new Set(rows.filter((r) => r.plan === "premium" && (!r.expiresAt || r.expiresAt > now)).map((r) => r.ownerId));
}

/** Accounts that studied in the last 7 days. */
async function activeOwners(ownerIds: string[], now: Date): Promise<Set<string>> {
  if (!ownerIds.length) return new Set();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.selectDistinct({ ownerId: studySessionsTable.ownerId }).from(studySessionsTable)
    .where(and(inArray(studySessionsTable.ownerId, ownerIds), gt(studySessionsTable.updatedAt, since)));
  return new Set(rows.map((r) => r.ownerId));
}

type Books = {
  reps: Rep[];
  signupsByRep: Map<string, string[]>;
  live: (typeof repPaymentsTable.$inferSelect)[];
  payouts: (typeof repPayoutsTable.$inferSelect)[];
  paying: Set<string>;
  active: Set<string>;
};

async function books(repIds: string[] | null, now: Date): Promise<Books> {
  const reps = repIds ? (repIds.length ? await db.select().from(repsTable).where(inArray(repsTable.id, repIds)) : []) : await db.select().from(repsTable);
  const ids = reps.map((r) => r.id);
  const signups = ids.length ? await db.select().from(repSignupsTable).where(inArray(repSignupsTable.repId, ids)) : [];
  const payments = ids.length ? await db.select().from(repPaymentsTable).where(inArray(repPaymentsTable.repId, ids)) : [];
  const payouts = ids.length ? await db.select().from(repPayoutsTable).where(inArray(repPayoutsTable.repId, ids)) : [];
  const signupsByRep = new Map<string, string[]>();
  for (const s of signups) signupsByRep.set(s.repId, [...(signupsByRep.get(s.repId) ?? []), s.ownerId]);
  const owners = signups.map((s) => s.ownerId);
  return { reps, signupsByRep, live: payments.filter((p) => isLive(p.environment)), payouts, paying: await payingOwners(owners, now), active: await activeOwners(owners, now) };
}

function rowFor(rep: Rep, b: Books, month: string, baseUrl: string): RepRow {
  const owners = b.signupsByRep.get(rep.id) ?? [];
  const netCents = b.live.filter((p) => p.repId === rep.id && p.month === month).reduce((sum, p) => sum + p.netCents, 0);
  return {
    id: rep.id, name: rep.name, school: rep.school, code: rep.code, sharePercent: rep.sharePercent, active: rep.active,
    signups: owners.length,
    active7d: owners.filter((o) => b.active.has(o)).length,
    paying: owners.filter((o) => b.paying.has(o)).length,
    netCents,
    shareCents: shareCents(netCents, rep.sharePercent),
    paid: b.payouts.some((p) => p.repId === rep.id && p.month === month),
    link: `${baseUrl}/reps/${rep.token}`,
  };
}

/** Dan's page: every rep for one month, plus the months that have any data. */
export async function repsReport(month: string, baseUrl: string, now: Date = new Date()): Promise<RepsReport> {
  const b = await books(null, now);
  const current = monthOf(now);
  const first = [...b.live.map((p) => p.month), ...b.payouts.map((p) => p.month), ...b.reps.map((r) => monthOf(r.createdAt))].sort()[0] ?? current;
  const months = monthsBetween(first < current ? first : current, current > month ? current : month);
  const rows = b.reps.map((r) => rowFor(r, b, month, baseUrl)).sort((a, z) => z.netCents - a.netCents || z.signups - a.signups || a.name.localeCompare(z.name));
  return {
    month,
    months,
    totals: {
      signups: rows.reduce((s, r) => s + r.signups, 0),
      paying: rows.reduce((s, r) => s + r.paying, 0),
      netCents: rows.reduce((s, r) => s + r.netCents, 0),
      owedCents: rows.filter((r) => !r.paid).reduce((s, r) => s + r.shareCents, 0),
    },
    reps: rows,
  };
}

export async function repRow(repId: string, month: string, baseUrl: string, now: Date = new Date()): Promise<RepRow | null> {
  const b = await books([repId], now);
  const rep = b.reps[0];
  return rep ? rowFor(rep, b, month, baseUrl) : null;
}

export type CreateResult = { ok: true; rep: Rep } | { ok: false; status: 400 | 409; error: string };

export async function createRep(input: { name?: unknown; school?: unknown; code?: unknown; sharePercent?: unknown }): Promise<CreateResult> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const school = typeof input.school === "string" ? input.school.trim().slice(0, 80) : "";
  if (!name || !school) return { ok: false, status: 400, error: "A rep needs a name and a school." };
  const sharePercent = input.sharePercent === undefined ? 50 : Number(input.sharePercent);
  if (!Number.isInteger(sharePercent) || sharePercent < 0 || sharePercent > 100) return { ok: false, status: 400, error: "The share is a whole percent from 0 to 100." };
  const taken = new Set((await db.select({ code: repsTable.code }).from(repsTable)).map((r) => r.code));
  let code: string;
  if (input.code !== undefined && input.code !== null && input.code !== "") {
    code = normalizeCode(input.code);
    if (code.length < 3) return { ok: false, status: 400, error: "A code needs at least 3 letters or digits." };
    if (taken.has(code)) return { ok: false, status: 409, error: `The code ${code} is already taken.` };
  } else {
    code = generateCode(name, school, (c) => taken.has(c));
  }
  const rows = await db.insert(repsTable).values({ id: randomUUID(), code, name, school, sharePercent, token: randomBytes(24).toString("base64url") })
    .onConflictDoNothing().returning();
  if (!rows[0]) return { ok: false, status: 409, error: `The code ${code} is already taken.` };
  return { ok: true, rep: rows[0] };
}

/** "Mark paid" records the share at that moment; "unmark" removes it. */
export async function setPaid(repId: string, month: string, paid: boolean, baseUrl: string, now: Date = new Date()): Promise<RepRow | null> {
  const row = await repRow(repId, month, baseUrl, now);
  if (!row) return null;
  if (paid) {
    await db.insert(repPayoutsTable).values({ repId, month, amountCents: row.shareCents }).onConflictDoNothing();
  } else {
    await db.delete(repPayoutsTable).where(and(eq(repPayoutsTable.repId, repId), eq(repPayoutsTable.month, month)));
  }
  return repRow(repId, month, baseUrl, now);
}

export type RepPage = {
  firstName: string; school: string; code: string; sharePercent: number;
  signups: number; active7d: number; paying: number; earnedCents: number;
  month: string; monthShareCents: number; monthPaying: number;
  months: { month: string; paying: number; shareCents: number; paid: boolean }[];
};

/** The rep's own page: their numbers only. */
export async function repPage(rep: Rep, now: Date = new Date()): Promise<RepPage> {
  const b = await books([rep.id], now);
  const current = monthOf(now);
  const months = [...new Set([current, ...b.live.map((p) => p.month)])].sort().reverse();
  const monthRows = months.map((m) => {
    const inMonth = b.live.filter((p) => p.month === m);
    return {
      month: m,
      paying: new Set(inMonth.filter((p) => p.netCents > 0).map((p) => p.ownerId)).size,
      shareCents: shareCents(inMonth.reduce((s, p) => s + p.netCents, 0), rep.sharePercent),
      paid: b.payouts.some((p) => p.month === m),
    };
  });
  const row = rowFor(rep, b, current, "");
  const thisMonth = monthRows.find((m) => m.month === current)!;
  return {
    firstName: firstName(rep.name), school: rep.school, code: rep.code, sharePercent: rep.sharePercent,
    signups: row.signups, active7d: row.active7d, paying: row.paying,
    earnedCents: monthRows.reduce((s, m) => s + m.shareCents, 0),
    month: current, monthShareCents: thisMonth.shareCents, monthPaying: thisMonth.paying,
    months: monthRows,
  };
}
