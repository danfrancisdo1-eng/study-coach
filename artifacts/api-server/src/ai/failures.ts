// D-223: every AI call that fails is told to one listener (the app sends an alert email for the
// failures a person must fix). The AI code never depends on how alerts are sent, so evals run without it.
export type AiFailure = { provider: "anthropic" | "openai"; feature: string; error: unknown };
type FailureListener = (failure: AiFailure) => void;
let failureListener: FailureListener | null = null;
export function setFailureListener(listener: FailureListener | null): void { failureListener = listener; }
/** Tells the listener; never throws, so the caller's own error handling is unchanged. */
export function reportFailure(failure: AiFailure): void {
  try { failureListener?.(failure); } catch { /* an alert never fails a call */ }
}
