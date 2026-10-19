// Premium rules (D-090), pure so they can be unit-tested without a database: what each plan
// allows, which courses stay active after a lapse, whether a state save adds a course the
// plan does not allow, and how a RevenueCat event updates the stored entitlement.

export type Plan = "free" | "premium";
export type PlanLimits = { courses: number | null; sets: number; messages: number };

export const LIMITS: Record<Plan, PlanLimits> = {
  free: { courses: 1, sets: 3, messages: 40 },
  premium: { courses: null, sets: 20, messages: 300 },
};

// D-153 (SPEC §9): a certification exam's first 50 questions are free; then the exam pass, a one-time
// Apple purchase (non-renewing) that gives 60 days of everything. Students: Apple's free week, then a subscription.
export const EXAM_FREE_QUESTIONS = 50;
export const EXAM_PASS_DAYS = 60;
const DAY_MS = 86_400_000;

/** The exam pass product (EXAM_PASS_PRODUCT_ID, default rapidrecall.exampass.60d; any id naming an exam pass). */
export function isExamPass(productId: string | null | undefined): boolean {
  if (!productId) return false;
  const configured = process.env["EXAM_PASS_PRODUCT_ID"];
  return productId === configured || /exam.?pass/i.test(productId);
}

/** How many free questions an exam still has on the free plan. */
export function examFreeLeft(served: number): number {
  return Math.max(0, EXAM_FREE_QUESTIONS - served);
}

export type Entitlement = { plan: Plan; expiresAt: Date | null; productId?: string | null; lastEventAt?: Date | null };

/** Premium while the stored plan is premium and has not expired (no expiry = no end). */
export function isPremium(entitlement: Pick<Entitlement, "plan" | "expiresAt"> | null | undefined, now: Date = new Date()): boolean {
  if (!entitlement || entitlement.plan !== "premium") return false;
  return entitlement.expiresAt === null || entitlement.expiresAt.getTime() > now.getTime();
}

/** OWNER_ACCOUNT_IDS: comma-separated Clerk user ids that are always Premium (Dan's own account). */
export function ownerAccounts(value: string | undefined): string[] {
  return (value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/** After a lapse the first course added stays active; Premium keeps every course active. */
export function activeCourseIds(courses: { id: string }[], premium: boolean): string[] {
  if (premium) return courses.map((c) => c.id);
  return courses.slice(0, 1).map((c) => c.id);
}

/**
 * True when a state save would add a course the plan does not allow. Saving with the same or
 * fewer courses is always fine (an account that already has extra courses can edit and delete);
 * a free account may not bring in a course id that was not there before once it has one.
 */
export function addsCourseBeyondPlan(before: { id: string }[], after: { id: string }[], premium: boolean): boolean {
  const max = LIMITS[premium ? "premium" : "free"].courses;
  if (max === null) return false;
  const known = new Set(before.map((c) => c.id));
  const added = after.filter((c) => !known.has(c.id));
  return added.length > 0 && after.length > max;
}

export type RevenueCatEvent = {
  type: string;
  event_timestamp_ms?: number;
  expiration_at_ms?: number | null;
  product_id?: string;
  cancel_reason?: string;
  purchased_at_ms?: number;
};

const GRANTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "CANCELLATION", "BILLING_ISSUE"]);

/**
 * The entitlement after a RevenueCat event, or null when the event changes nothing (older than
 * the last one applied, a test event, or a type we do not act on). Every granting type carries
 * the paid-through date, so a cancellation keeps Premium until then and a refund (a cancellation
 * whose expiry is already past) ends it at once; EXPIRATION ends it.
 */
export function applyEvent(current: Entitlement | null, event: RevenueCatEvent): Entitlement | null {
  if (typeof event.event_timestamp_ms !== "number") return null;
  const at = new Date(event.event_timestamp_ms);
  if (current?.lastEventAt && current.lastEventAt.getTime() >= at.getTime()) return null;
  const productId = event.product_id ?? current?.productId ?? null;
  if (event.type === "EXPIRATION") {
    return { plan: "free", expiresAt: typeof event.expiration_at_ms === "number" ? new Date(event.expiration_at_ms) : at, productId, lastEventAt: at };
  }
  if (!GRANTS.has(event.type)) return null;
  // D-153: an exam pass carries no expiry (non-renewing): it lasts EXAM_PASS_DAYS from the purchase.
  const passEnds = isExamPass(event.product_id) ? new Date((event.purchased_at_ms ?? event.event_timestamp_ms) + EXAM_PASS_DAYS * DAY_MS) : null;
  const expiresAt = typeof event.expiration_at_ms === "number" ? new Date(event.expiration_at_ms) : passEnds;
  return { plan: "premium", expiresAt, productId, lastEventAt: at };
}

/** The sentence a student sees when a limit stops them; never a code or a number they cannot act on. */
export function limitMessage(kind: "course" | "sets" | "messages" | "read_only" | "exam_free", limits: PlanLimits): string {
  switch (kind) {
    case "exam_free": return `You've used your ${EXAM_FREE_QUESTIONS} free questions for this exam. The exam pass unlocks everything for ${EXAM_PASS_DAYS} days.`;
    case "course": return "Your free plan has one course or exam. Premium adds as many as you like.";
    case "sets": return `You've used today's ${limits.sets} sets. More tomorrow${limits.courses === null ? "." : ", or go Premium for 20 a day."}`;
    case "messages": return `You've used today's ${limits.messages} coach messages. More tomorrow${limits.courses === null ? "." : ", or go Premium for 300 a day."}`;
    case "read_only": return "This course is read-only on the free plan. Renew Premium to study it with the coach again; everything in it is kept.";
  }
}
