// Campus reps (D-219; mock Dan approved: RepCode / RepPage / RepAdmin). Three parts:
// - GET /reps/check (no sign-in: the sign-up screen) and POST /study/rep-code (the signed-in account claims it);
// - owner-only (OWNER_ACCOUNT_IDS) admin routes: every rep for a month, add a rep, mark a month paid;
// - GET /reps/:token (pageRouter, mounted at the root like the privacy page): the rep's private page.
import { Router, type IRouter, type Request, type Response } from "express";
import { ownerAccounts } from "../lib/premium";
import { dollars, firstName, isMonth, monthOf, percentWords } from "../lib/reps";
import { claimCode, createRep, repByCode, repByToken, repPage, repsReport, setPaid } from "../lib/reps-store";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();
export const pageRouter: IRouter = Router();

/** The absolute address the rep links point at: PUBLIC_BASE_URL, else this request's own host. */
export function baseUrl(req: Request): string {
  const configured = process.env["PUBLIC_BASE_URL"]?.replace(/\/+$/, "");
  if (configured) return configured;
  const proto = (req.get("x-forwarded-proto") ?? req.protocol ?? "https").split(",")[0]!.trim();
  return `${proto}://${req.get("host") ?? "localhost"}`;
}

// A light guard for the one open lookup: 20 a minute per address.
const lookups = new Map<string, { count: number; resetAt: number }>();
function allowLookup(ip: string, now = Date.now()): boolean {
  if (lookups.size > 5000) for (const [key, value] of lookups) if (value.resetAt <= now) lookups.delete(key);
  const entry = lookups.get(ip);
  if (!entry || entry.resetAt <= now) {
    lookups.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}

router.get("/reps/check", async (req, res): Promise<void> => {
  if (!allowLookup(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many tries. Wait a minute and try again." });
    return;
  }
  const rep = await repByCode(typeof req.query.code === "string" ? req.query.code : "");
  res.json(rep ? { valid: true, name: firstName(rep.name), school: rep.school } : { valid: false });
});

router.post("/study/rep-code", requireStudyAuth, async (req, res): Promise<void> => {
  const code = (req.body as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "Type the code your campus rep gave you." });
    return;
  }
  const result = await claimCode(req.studyOwnerId!, code);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  req.log.info({ repId: result.rep.id }, "Campus rep code claimed");
  res.json({ code: result.rep.code, name: firstName(result.rep.name), school: result.rep.school });
});

/** Owner-only: OWNER_ACCOUNT_IDS (Dan's account), the same list that is always Premium. */
function requireOwner(req: Request, res: Response): boolean {
  if (!ownerAccounts(process.env["OWNER_ACCOUNT_IDS"]).includes(req.studyOwnerId ?? "")) {
    res.status(403).json({ error: "Only the app's owner can see campus reps." });
    return false;
  }
  return true;
}

router.get("/admin/reps", requireStudyAuth, async (req, res): Promise<void> => {
  if (!requireOwner(req, res)) return;
  const month = isMonth(req.query.month) ? req.query.month : monthOf(new Date());
  res.json(await repsReport(month, baseUrl(req)));
});

router.post("/admin/reps", requireStudyAuth, async (req, res): Promise<void> => {
  if (!requireOwner(req, res)) return;
  const result = await createRep((req.body ?? {}) as Record<string, unknown>);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const report = await repsReport(monthOf(new Date()), baseUrl(req));
  req.log.info({ repId: result.rep.id, code: result.rep.code }, "Campus rep added");
  res.json(report.reps.find((r) => r.id === result.rep.id));
});

async function payout(req: Request, res: Response, paid: boolean): Promise<void> {
  if (!requireOwner(req, res)) return;
  const month = req.params["month"];
  if (!isMonth(month)) {
    res.status(400).json({ error: "The month looks like 2026-11." });
    return;
  }
  const row = await setPaid(String(req.params["repId"]), month, paid, baseUrl(req));
  if (!row) {
    res.status(404).json({ error: "That rep was not found." });
    return;
  }
  res.json(row);
}
router.put("/admin/reps/:repId/payouts/:month", requireStudyAuth, (req, res) => payout(req, res, true));
router.delete("/admin/reps/:repId/payouts/:month", requireStudyAuth, (req, res) => payout(req, res, false));

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const pageStyle = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1726; color: #e9eef6; font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 440px; margin: 0 auto; padding: 26px 18px 40px; display: flex; flex-direction: column; gap: 14px; }
  .kicker { font-size: 13px; font-weight: 700; letter-spacing: .6px; color: #7c9bff; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 2px 0 0; } .muted { color: #93a1b8; font-size: 15px; } .small { color: #93a1b8; font-size: 12.5px; }
  .card { padding: 12px 14px; border-radius: 14px; background: #152036; border: 1px solid #243049; }
  .code { font-size: 22px; font-weight: 800; letter-spacing: 1px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .num { font-size: 28px; font-weight: 800; } .label { font-size: 13px; color: #93a1b8; }
  .share { background: linear-gradient(135deg, #1d2d55, #16223f); border-color: #2c3d66; }
  .big { font-size: 32px; font-weight: 800; color: #f2b544; }
  table { width: 100%; border-collapse: collapse; } th, td { padding: 10px 6px; text-align: right; font-size: 15px; border-bottom: 1px solid #1d2840; }
  th { font-size: 12.5px; color: #93a1b8; font-weight: 600; } th:first-child, td:first-child { text-align: left; }
  .paid { color: #5fd08f; font-weight: 700; font-size: 13px; } .due { color: #f2b544; font-weight: 700; font-size: 13px; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>${pageStyle}</style></head><body><main>${body}</main></body></html>`;
}

pageRouter.get("/reps/:token", async (req, res): Promise<void> => {
  const rep = await repByToken(String(req.params["token"] ?? ""));
  res.setHeader("Cache-Control", "no-store");
  if (!rep) {
    res.status(404).type("html").send(page("Not found", `<p class="kicker">RapidRecall AI</p><h1>This link doesn't work</h1><p class="muted">Check the link your RapidRecall AI contact sent you.</p>`));
    return;
  }
  const p = await repPage(rep);
  const rows = p.months.map((m) => `<tr><td>${escape(monthName(m.month).split(" ")[0]!)}</td><td>${m.paying}</td><td>${dollars(m.shareCents)}</td><td class="${m.paid ? "paid" : "due"}">${m.paid ? "Paid" : m.shareCents > 0 ? "Due" : "–"}</td></tr>`).join("");
  res.type("html").send(page(`${p.firstName}'s RapidRecall AI page`, `
    <div><div class="kicker">RapidRecall AI · Campus rep</div><h1>Hi ${escape(p.firstName)} 👋</h1><div class="muted">${escape(p.school)} · your private page</div></div>
    <div class="card"><div class="small">Your code</div><div class="code">${escape(p.code)}</div><div class="small">Students type it when they sign up.</div></div>
    <div class="grid">
      <div class="card"><div class="num">${p.signups}</div><div class="label">signed up with your code</div></div>
      <div class="card"><div class="num">${p.active7d}</div><div class="label">studied this week</div></div>
      <div class="card"><div class="num">${p.paying}</div><div class="label">paying for Premium</div></div>
      <div class="card"><div class="num">${dollars(p.earnedCents)}</div><div class="label">earned so far</div></div>
    </div>
    <div class="card share"><div class="small">Your share this month (${escape(monthName(p.month).split(" ")[0]!)})</div><div class="big">${dollars(p.monthShareCents)}</div>
      <div class="small">${percentWords(p.sharePercent)} of what RapidRecall received from your ${p.monthPaying} paying student${p.monthPaying === 1 ? "" : "s"}, after Apple's fee.</div></div>
    <div class="card" style="padding: 4px 8px"><table><tr><th>Month</th><th>Paying</th><th>Your share</th><th>Status</th></tr>${rows}</table></div>
    <p class="small">Counts only: you never see who signed up. Purchases made in TestFlight (testing) don't count.</p>`));
});

export default router;
