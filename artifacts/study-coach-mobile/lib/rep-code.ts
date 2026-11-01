/**
 * Campus rep codes on the phone (D-219; the mock Dan approved: "Got a code from a campus rep? (optional)").
 * The code typed at sign-up is kept on the phone until the account exists (Apple and Google sign-in leave the
 * screen), then claimed once. Pure, so node tests load it.
 */

/** Where the typed code waits until the account exists (one per phone; cleared once claimed or refused). */
export const PENDING_REP_CODE_KEY = 'rapidrecall-pending-rep-code';

/** "jane om " → "JANE-OM": trimmed, uppercase, spaces to dashes, only letters, digits and dashes, at most 24. */
export function normalizeRepCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').slice(0, 24);
}

/** Worth asking the server about: at least 4 characters once normalized. */
export function isCheckableRepCode(code: string): boolean {
  return normalizeRepCode(code).length >= 4;
}

/** The line under the field, from the server's check (null while there is nothing to say). */
export function repCodeLine(code: string, check: { valid: boolean; name?: string; school?: string } | undefined): { kind: 'ok' | 'unknown'; text: string } | null {
  if (!isCheckableRepCode(code) || !check) return null;
  if (check.valid) return { kind: 'ok', text: `From ${check.name ?? 'your rep'}${check.school ? ` at ${check.school}` : ''}. Thanks for joining through them!` };
  return { kind: 'unknown', text: "We don't know that code. Check it with your rep, or leave it empty." };
}

/** After a claim attempt: forget the code unless the phone simply could not reach the server (try again next time). */
export function forgetPendingCode(status: number | undefined): boolean {
  return typeof status === 'number' && status > 0 && status < 500;
}

/** Cents as dollars, e.g. 2975 → "$29.75". */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** "2026-10" → "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return y && m && m >= 1 && m <= 12 ? `${names[m - 1]} ${y}` : month;
}
