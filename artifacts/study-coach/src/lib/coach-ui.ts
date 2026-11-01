// D-303: the web Coach screen's plain logic (the mock Dan approved: plan line with the live count,
// the daily-limit dialog, Report under a reply, the AI agreement, the exam countdown). Pure, so node
// tests load it; the phone's own rules are imported from its lib files (relative .ts paths for node).
import { planLine, premiumCode, type PremiumCode } from '../../../study-coach-mobile/lib/premium-ui.ts';
import { AI_NOTICE } from '../../../study-coach-mobile/lib/ai-consent.ts';
import { daysLeft, daysLeftLabel } from '../../../study-coach-mobile/lib/syllabus.ts';
import { describeExamDate } from '../../../study-coach-mobile/lib/exam-date.ts';

export { premiumCode, type PremiumCode };

export type PlanStatus = {
  enforced: boolean;
  plan: 'free' | 'trial' | 'premium';
  source: string | null;
  expiresAt: string | null;
  productId?: string | null;
  limits: { messages: number; sets: number; courses: number | null };
  usage: { messages: number; sets: number; resetAt: string | null };
};

/**
 * The live count (Dan: "yes show the live count"), from the server's own limits and today's usage, so it
 * never drifts from what the server allows. None while the server does not enforce limits (the beta).
 */
export function messagesLeftLine(status: PlanStatus | null | undefined): string | null {
  if (!status || !status.enforced || !(status.limits.messages > 0)) return null;
  const left = Math.max(0, status.limits.messages - Math.max(0, status.usage.messages));
  return `${left} of ${status.limits.messages} coach messages left today`;
}

/** The plan line in the menu: the phone's wording, then the live count when there is one. */
export function planSummary(status: PlanStatus | null | undefined): { plan: string; count: string | null; upgrade: boolean } {
  return { plan: planLine(status ?? null), count: messagesLeftLine(status), upgrade: !status || status.plan === 'free' };
}

/** The dialog for a request the plan stopped (402). The web sells nothing: Premium is bought in the iPhone app. */
export function limitCopy(code: PremiumCode, status?: PlanStatus | null): { title: string; body: string } {
  switch (code) {
    case 'daily_limit': {
      const count = status?.enforced && status.limits.messages > 0 ? ` You used all ${status.limits.messages} for today.` : '';
      return { title: "That's today's free coaching", body: `Your coach messages come back tomorrow.${count} Your chat, answers and draft are saved.` };
    }
    case 'premium_required': return { title: 'One course on the free plan', body: 'The free plan has one course or exam. Your saved work stays.' };
    case 'course_read_only': return { title: 'This course is read-only', body: 'On the free plan you can read this course, but the coach works in your one active course.' };
    case 'exam_free_used': return { title: 'Free questions used', body: "You've used your 50 free questions for this exam. Your results are saved." };
    case 'trial_required': return { title: 'Start your free week first', body: 'Practice sets start with the free week, which you start in the iPhone app.' };
  }
}

export const PREMIUM_ON_IPHONE = 'Premium is bought in the RapidRecall app on iPhone. Once it is on your account, it works here too, with the same sign-in.';

/** The AI agreement, word for word as on the phone, except the line about reporting (no press and hold on the web). */
export const WEB_AI_NOTICE = AI_NOTICE.map((line) => line.icon === 'alert-circle'
  ? { ...line, text: 'AI can make mistakes. Use Report under any coach reply to tell us.' }
  : line);

export const REPORT_REASONS = [
  { reason: 'wrong', label: 'It is wrong' },
  { reason: 'harmful', label: 'It is harmful or upsetting' },
  { reason: 'other', label: 'Something else' },
] as const;
export type ReportReason = typeof REPORT_REASONS[number]['reason'];

/** "13 days left · Nov 14" for an exam with a date still ahead; null otherwise. */
export function countdownText(course: { kind?: unknown; examDate?: unknown } | null | undefined, today: Date = new Date()): string | null {
  if (!course || course.kind !== 'exam') return null;
  const days = daysLeft(course.examDate, today);
  if (days === null) return null;
  return `${daysLeftLabel(days)} · ${describeExamDate(String(course.examDate))}`;
}

type AnchorMessage = { id: string; actions?: { type: string; sessionId?: string | null }[] | null };

/**
 * D-304 (Dan: start the coach's review after the set, not before it): the coach message a set's card sits
 * under, so the card stays where the set started and everything said after it (the score, the review of
 * the misses) comes below it. A quiz: the message whose start_quiz action holds its session; a deck: the
 * last message that started flashcards. Null: no such message in the thread (the card goes at the end).
 */
export function setCardAnchor(messages: readonly AnchorMessage[], card: { kind: 'quiz'; sessionId: string } | { kind: 'deck' }): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    for (const action of message.actions ?? []) {
      if (card.kind === 'quiz' && action.type === 'start_quiz' && action.sessionId === card.sessionId) return message.id;
      if (card.kind === 'deck' && action.type === 'start_flashcards') return message.id;
    }
  }
  return null;
}
