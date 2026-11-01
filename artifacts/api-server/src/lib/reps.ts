// Campus reps (D-219; Dan: "I'll split you how much they pay. Is there a way to like track"): the pure rules.
// Codes, the money from a RevenueCat event, the rep's share and month buckets. No imports, so unit tests load it.

/** Codes compare without case or surrounding space; only letters, digits and dashes are kept. */
export function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40) : "";
}

/** A school's short form for a code: its capital letters ("Ole Miss" → OM, "Texas A&M" → TAM), else the first word. */
export function schoolAbbr(school: string): string {
  const words = school.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "").join("").toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 5);
  return (words[0] ?? "RR").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5) || "RR";
}

/** FIRSTNAME-SCHOOL (e.g. JANE-OM); a digit is added until it is not taken. */
export function generateCode(name: string, school: string, taken: (code: string) => boolean): string {
  const first = (name.trim().split(/\s+/)[0] ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "REP";
  const base = `${first}-${schoolAbbr(school)}`;
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken(`${base}${n}`)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** The first name only (what a student sees when they type a code). */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** YYYY-MM in UTC. */
export function monthOf(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Months from `from` to `to` (both YYYY-MM), newest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = to.split("-").map(Number) as [number, number];
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    if (out.length > 120) break;
  }
  return out;
}

/** Event types that move money for a rep (RevenueCat webhook `type`). */
const PAID = new Set(["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE", "PRODUCT_CHANGE", "UNCANCELLATION"]);
const REFUNDISH = new Set(["CANCELLATION", "REFUND", "REFUND_REVERSED"]);

/** What RapidRecall keeps of a price when the event does not say (Apple's Small Business Program: 15%). */
export const DEFAULT_TAKEHOME = 0.85;

export type RepPayment = { priceCents: number; netCents: number; type: string; productId: string | null; environment: string; occurredAt: Date };

/**
 * The money in a RevenueCat event, or null when it moves none: a purchase or renewal with a positive price,
 * or a refund-like event with a negative price (RevenueCat reports refunds as a negative `price`). Net is the
 * price times the event's `takehome_percentage`, else `takehome` (REP_TAKEHOME, default 0.85).
 */
export function paymentFromEvent(event: Record<string, unknown>, takehome: number = DEFAULT_TAKEHOME): RepPayment | null {
  const type = typeof event["type"] === "string" ? event["type"] : "";
  const price = typeof event["price"] === "number" && Number.isFinite(event["price"]) ? event["price"] : null;
  if (price === null || price === 0) return null;
  if (price > 0 && !PAID.has(type)) return null;
  if (price < 0 && !REFUNDISH.has(type) && !PAID.has(type)) return null;
  const share = typeof event["takehome_percentage"] === "number" && event["takehome_percentage"] > 0 && event["takehome_percentage"] <= 1
    ? event["takehome_percentage"] : takehome;
  const priceCents = Math.round(price * 100);
  const atMs = typeof event["purchased_at_ms"] === "number" ? event["purchased_at_ms"] : typeof event["event_timestamp_ms"] === "number" ? event["event_timestamp_ms"] : Date.now();
  return {
    priceCents,
    netCents: Math.round(priceCents * share),
    type,
    productId: typeof event["product_id"] === "string" ? event["product_id"] : null,
    environment: typeof event["environment"] === "string" ? event["environment"].toUpperCase() : "PRODUCTION",
    occurredAt: new Date(atMs),
  };
}

/** Sandbox (TestFlight) payments are kept but never counted as money. */
export const isLive = (environment: string): boolean => environment.toUpperCase() !== "SANDBOX";

/** The rep's share of what RapidRecall received, rounded to the cent. */
export function shareCents(netCents: number, sharePercent: number): number {
  return Math.round((netCents * sharePercent) / 100);
}

/** "Half" at 50%, else "N%" (the rep page's sentence). */
export function percentWords(sharePercent: number): string {
  return sharePercent === 50 ? "Half" : `${sharePercent}%`;
}

export const dollars = (cents: number): string => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** REP_TAKEHOME env (0–1), else the default. */
export function takehomeFrom(env: Record<string, string | undefined>): number {
  const value = Number(env["REP_TAKEHOME"]);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : DEFAULT_TAKEHOME;
}
