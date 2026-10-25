/**
 * Premium on the phone (D-090), the parts that are plain logic: which server refusals open the
 * paywall, the plan line for the Account page, and the order and labels of the two packages.
 */
export type PremiumCode = 'premium_required' | 'daily_limit' | 'course_read_only' | 'exam_free_used' | 'trial_required';

/** The server's 402 code, when a request was stopped by the plan; null for any other failure. */
export function premiumCode(problem: unknown): PremiumCode | null {
  if (!problem || typeof problem !== 'object') return null;
  const p = problem as { status?: unknown; data?: { code?: unknown } };
  if (p.status !== 402) return null;
  const code = p.data?.code;
  return code === 'premium_required' || code === 'daily_limit' || code === 'course_read_only' || code === 'exam_free_used' || code === 'trial_required' ? code : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Premium · renews Nov 12, 2026", "Premium · owner", or "Free plan · 1 course". */
export function planLine(status: { plan: 'free' | 'trial' | 'premium'; source: string | null; expiresAt: string | null; productId?: string | null } | null | undefined): string {
  if (!status) return 'Free plan';
  if (status.plan === 'trial' && status.expiresAt) {
    const d = new Date(status.expiresAt);
    return `Free week · ends ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  if (status.plan === 'premium') {
    if (status.source === 'owner') return 'Premium · owner account';
    if (!status.expiresAt) return 'Premium';
    const d = new Date(status.expiresAt);
    // D-153: the exam pass does not renew; it ends.
    if (status.productId && /exam.?pass/i.test(status.productId)) return `Exam pass · until ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    return `Premium · renews ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  return 'Free plan · 1 course';
}

/**
 * Monthly first and picked by default, then yearly; anything else after. D-197 (Dan, build 23): with Yearly
 * picked first "it doesn't make it apparent how to get the free week"; a student who wants yearly taps it.
 */
export function orderPackages<T extends { packageType: string }>(packages: T[]): T[] {
  const rank = (t: string) => (t === 'MONTHLY' ? 0 : t === 'ANNUAL' ? 1 : 2);
  return [...packages].sort((a, b) => rank(a.packageType) - rank(b.packageType));
}

export function packageLabel(packageType: string): string {
  return packageType === 'ANNUAL' ? 'Yearly' : packageType === 'MONTHLY' ? 'Monthly' : 'Premium';
}

/** Why the paywall opened, as its first line. */
export function paywallReason(reason: string | undefined): string {
  switch (reason) {
    case 'premium_required': return 'The free plan has one course or exam.';
    case 'daily_limit': return "You've reached today's free limit.";
    case 'course_read_only': return 'This course is read-only on the free plan.';
    case 'exam_free_used': return "You've used your 50 free questions for this exam.";
    case 'trial_required': return 'Start your free week to study with the coach.';
    default: return 'Study every course with your coach.';
  }
}

/** D-153: which paywall: the exam pass (a certification exam) or the student subscription. */
export function paywallMode(reason: string | undefined, kind: string | undefined): 'exam' | 'student' {
  return reason === 'exam_free_used' || kind === 'exam' ? 'exam' : 'student';
}

/** The yearly badge: the real saving against twelve months, rounded down, or none. */
export function savingLabel(monthly: number, yearly: number): string | null {
  if (!(monthly > 0) || !(yearly > 0)) return null;
  const saving = Math.floor((1 - yearly / (monthly * 12)) * 100);
  return saving > 0 ? `Save ${saving}%` : null;
}

/** What the student is agreeing to, on the paywall itself (Apple and the paywall rules). */
export function trialTerms(price: string, period: 'month' | 'year', trial: string | null): string {
  // D-159 (store preflight): the trial length comes from the store, and the cancel rule is Apple's (24 hours before it ends).
  return trial
    ? `Free for ${trial}, then ${price} a ${period}. Cancel in Settings at least 24 hours before the free ${trial} ends and you pay nothing.`
    : `${price} a ${period}. Renews automatically; cancel any time in Settings.`;
}

/** The card's free-trial line ("1 week free"), or null when the product has no free trial. */
export function trialBadge(trial: string | null): string | null {
  return trial ? `${trial} free` : null;
}

/** The free trial's length as the store reports it ("7 days", "1 week", "1 month"), or null without a free trial. */
export function trialLength(intro: { price: number; periodNumberOfUnits: number; periodUnit: string } | null | undefined): string | null {
  if (!intro || intro.price !== 0 || !(intro.periodNumberOfUnits > 0)) return null;
  const unit = intro.periodUnit.toLowerCase();
  const word = unit.startsWith('day') ? 'day' : unit.startsWith('week') ? 'week' : unit.startsWith('month') ? 'month' : unit.startsWith('year') ? 'year' : 'day';
  return `${intro.periodNumberOfUnits} ${word}${intro.periodNumberOfUnits === 1 ? '' : 's'}`;
}

/**
 * What the paywall's purchase area shows (D-161). A failed store fetch leaves no products, so the
 * cards must not render: the error line says what happened instead of the screen crashing.
 */
export function paywallState(available: boolean, packages: readonly unknown[] | null, error: string): 'unavailable' | 'loading' | 'empty' | 'error' | 'ready' {
  if (!available) return 'unavailable';
  if (packages === null) return 'loading';
  if (packages.length > 0) return 'ready';
  return error ? 'error' : 'empty';
}

/**
 * The paywall's comparison table (D-163). Short labels so each row stays on one line at large text
 * sizes, and the free column says what the free plan really allows: a student needs the free week
 * for practice sets (D-155); the coach chat stays open at the free daily limit.
 */
export function paywallRows(mode: 'exam' | 'student'): { head: [string, string]; rows: [string, string, string][] } {
  if (mode === 'exam') {
    return { head: ['Free', 'Exam Pass'], rows: [['Questions', '50', 'Unlimited'], ['Review PDF', 'Yes', 'Yes'], ['How long', 'Once', '60 days']] };
  }
  // D-180: "Free week" rather than "None": the free plan's practice sets come with the free week, and "None" read as a punishment line.
  return { head: ['Free', 'Premium'], rows: [['Courses', '1', 'Unlimited'], ['Practice sets', 'Free week', '20 a day'], ['Coach messages', '40 a day', '300 a day']] };
}

/**
 * The paywall's two products as a segment control (D-180): the student subscription and the exam
 * pass, each with one line that says who it is for. The paywall used to show the exam pass as a
 * card under the subscribe button that flipped the whole screen with no way back.
 */
export type PaywallSegment = { mode: 'student' | 'exam'; label: string; blurb: string };
export function paywallSegments(): PaywallSegment[] {
  return [
    { mode: 'student', label: 'Premium', blurb: 'Every course, with the coach. Renews monthly or yearly.' },
    { mode: 'exam', label: 'Exam Pass', blurb: 'One certification exam for 60 days. One payment, no renewal.' },
  ];
}
