import fs from "node:fs";
import path from "node:path";
import express, { type Router } from "express";

// D-300: the API server also serves the built web app (artifacts/study-coach/dist/public),
// so the web app and the API share one address (docs/plans/move-off-replit.md, Step 6 Option A).

/** Settings the web page needs at runtime. Only publishable values: this is sent to every browser. */
export type WebConfig = { clerkPublishableKey?: string };

/** Puts the runtime settings into index.html, before the app's own scripts run. */
export function injectWebConfig(html: string, config: WebConfig): string {
  // "<" is escaped so the value can never close the script tag.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  const tag = `<script>window.__STUDY_COACH_CONFIG__=${json};</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : `${tag}${html}`;
}

/** Where the built web app lives: WEB_DIST_DIR, else next to this bundle in the repo and the image. */
export function webDistDir(): string {
  return process.env["WEB_DIST_DIR"] ?? path.resolve(globalThis.__dirname ?? ".", "../../study-coach/dist/public");
}

/**
 * Addresses the server itself answers: the API, the public privacy/support pages and the
 * campus reps' pages (routes/privacy.ts, routes/reps.ts). Add a new root-level server page here.
 */
const SERVER_PATHS = ["/api", "/privacy", "/support", "/reps"];

export function isServerPath(pathname: string): boolean {
  return SERVER_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Static files plus the page for every other GET that a browser asks for as a page.
 * Returns null when the web app was not built, so the API runs on its own as before.
 * Mounted before Clerk's middleware: the page and its files need no sign-in check on the
 * server (Clerk would otherwise send a browser's first page load on a handshake redirect).
 */
export function webAppRouter(dir: string, config: WebConfig): Router | null {
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) return null;
  const page = injectWebConfig(fs.readFileSync(indexPath, "utf8"), config);
  const router = express.Router();

  router.use(express.static(dir, {
    index: false,
    setHeaders: (res, filePath) => {
      // Vite names built files by their content, so they can be kept for a year.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));

  router.get(/.*/, (req, res, next) => {
    // Server-owned addresses and missing files (a path ending in a file name) are not pages.
    const last = req.path.split("/").pop() ?? "";
    if (isServerPath(req.path) || last.includes(".")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(page);
  });
  return router;
}
