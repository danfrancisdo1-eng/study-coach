// D-223 (Dan: "Make it email it if the API starts failing"): after the Claude key expired (Nov 2) and
// OpenAI retired gpt-image-1 (Oct 23), features failed for days before anyone noticed. Now a failure
// a person must fix (rejected or expired key, no access, model gone, billing or quota) emails
// ALERT_EMAIL through Resend's HTTP API (RESEND_API_KEY), at most once per provider and kind every
// ALERT_WINDOW_MS (RESEND_API_URL only for tests). Passing trouble (overloaded, rate limited, timeouts, 5xx) never emails.
// Pure parts first, so unit tests load them.

export type AlertKind = "key_rejected" | "no_access" | "model_missing" | "billing" | "key_missing";

export const ALERT_WINDOW_MS = 6 * 60 * 60_000;

const KIND_TEXT: Record<AlertKind, { title: string; fix: string }> = {
  key_rejected: { title: "the API key was rejected", fix: "The key may be expired, deleted or mistyped. Create a new key in the provider's console and replace it in Render (Environment), then Save and deploy." },
  no_access: { title: "the account is not allowed to use this", fix: "Check the provider's console: organization verification, project model access, or the key's permissions." },
  model_missing: { title: "the model does not exist any more", fix: "The provider retired or renamed the model. Set the model in Render (for pictures: AI_IMAGE_MODEL) to a current one, then Save and deploy." },
  billing: { title: "billing or quota ran out", fix: "Add credits or raise the spending limit in the provider's billing page." },
  key_missing: { title: "the API key is not set", fix: "Add the key in Render (Environment), then Save and deploy." },
};

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status;
  const lead = /^(?:Error: )?(\d{3})\b/.exec(messageOf(error));
  return lead ? Number(lead[1]) : null;
};

export function messageOf(error: unknown): string {
  return (error instanceof Error ? `${error.message}` : String(error ?? "")).replace(/\s+/g, " ").trim().slice(0, 600);
}

/** The kind of failure, or null when it should pass by itself (overloaded, rate limited, timeouts, server errors). */
export function alertKind(error: unknown): AlertKind | null {
  const status = statusOf(error);
  const text = messageOf(error);
  if (/must be set|api key.*(missing|not set)/i.test(text) && status === null) return "key_missing";
  if (status === 401 || /invalid x-api-key|incorrect api key|authentication_error/i.test(text)) return "key_rejected";
  if (status === 402 || /credit balance|insufficient_quota|exceeded your current quota|billing/i.test(text)) return "billing";
  if (/model[^.]*(does not exist|not found)|model_not_found|has been (shut down|deprecated|retired)/i.test(text)) return "model_missing";
  if (status === 404) return "model_missing";
  if (status === 403 || /permission_error|must be verified|not allowed to (use|access)/i.test(text)) return "no_access";
  return null;
}

/** True when this provider and kind has not been emailed within the window; records it. */
export function firstInWindow(sent: Map<string, number>, key: string, now: number, windowMs = ALERT_WINDOW_MS): boolean {
  const last = sent.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  sent.set(key, now);
  return true;
}

const PROVIDER_NAME = { anthropic: "Claude (Anthropic)", openai: "OpenAI" } as const;

export function alertEmail(input: { provider: "anthropic" | "openai"; feature: string; kind: AlertKind; detail: string; at: Date }): { subject: string; text: string } {
  const what = KIND_TEXT[input.kind];
  const provider = PROVIDER_NAME[input.provider];
  return {
    subject: `RapidRecall AI alert: ${provider} is failing (${what.title})`,
    text: [
      `${provider} calls are failing on the server: ${what.title}.`,
      `First seen: ${input.at.toISOString()} while doing: ${input.feature}.`,
      "",
      `What to do: ${what.fix}`,
      "",
      `The provider said: ${input.detail}`,
      "",
      `You get at most one email per problem every ${ALERT_WINDOW_MS / 3_600_000} hours. Search the Render logs for "AI alert" to see each one.`,
    ].join("\n"),
  };
}

// The sender (fetch to Resend; no package). Settings from the environment.
type Log = { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const sent = new Map<string, number>();
let warnedUnset = false;

/** Logs every alert-worthy failure and emails the first of each kind in the window. Never throws. */
export async function notifyAiFailure(
  failure: { provider: "anthropic" | "openai"; feature: string; error: unknown },
  log: Log,
  env: Record<string, string | undefined> = process.env,
  send: Fetch = fetch as unknown as Fetch,
  now: () => Date = () => new Date(),
  memory: Map<string, number> = sent,
): Promise<void> {
  try {
    const kind = alertKind(failure.error);
    if (!kind) return;
    const detail = messageOf(failure.error);
    log.error({ provider: failure.provider, feature: failure.feature, kind, detail }, "AI alert");
    const key = env.RESEND_API_KEY?.trim();
    const to = env.ALERT_EMAIL?.trim();
    if (!key || !to) {
      if (!warnedUnset) { warnedUnset = true; log.warn({}, "AI alert not emailed: RESEND_API_KEY or ALERT_EMAIL is not set"); }
      return;
    }
    const at = now();
    if (!firstInWindow(memory, `${failure.provider}:${kind}`, at.getTime())) return;
    const { subject, text } = alertEmail({ provider: failure.provider, feature: failure.feature, kind, detail, at });
    const from = env.ALERT_FROM?.trim() || "RapidRecall alerts <onboarding@resend.dev>";
    const res = await send(env.RESEND_API_URL?.trim() || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, text }),
    });
    if (res.ok) log.info({ provider: failure.provider, kind }, "AI alert emailed");
    else {
      memory.delete(`${failure.provider}:${kind}`); // try again on the next failure
      log.error({ status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) }, "AI alert email failed");
    }
  } catch (error) {
    log.error({ error: messageOf(error) }, "AI alert email failed");
  }
}
