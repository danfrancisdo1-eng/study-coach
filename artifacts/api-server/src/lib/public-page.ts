import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { load } from "cheerio";

const MAX_BYTES = 2_000_000;

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast IPv6; exclude documentation, mapped IPv4 and transition ranges.
  const parts = address.split(":");
  const ietfSpecial = parts[0]?.toLowerCase() === "2001" && parseInt(parts[1] || "0", 16) < 0x200;
  return isIP(address) === 6 && /^[23]/i.test(address) && !ietfSpecial &&
    !/^(2001:(?:0*:|db8:|0*10:|0*20:)|2002:|3fff:)/i.test(address);
}

export function parsePublicUrl(input: string): URL {
  if (input.length > 2048) throw new Error("The link is too long.");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a complete http:// or https:// public page link."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443")) {
    throw new Error("Only public HTTP(S) pages without credentials or custom ports are supported.");
  }
  url.hash = "";
  return url;
}

export function pageText(html: string): { title: string; text: string } {
  const $ = load(html);
  if ($('input[type="password"]').length) throw new Error("Login pages cannot be imported.");
  const title = $("title").first().text().trim().slice(0, 180);
  $("script,style,noscript,svg,nav,header,footer,aside,form,[hidden],[aria-hidden=true]").remove();
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4,section,div,tr").append("\n");
  const main = $("article,main,[role=main]").first();
  const text = (main.length ? main.text() : $("body").text())
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  if (text.length < 40) throw new Error("No useful readable page text was found. The page may require login or JavaScript.");
  if (text.length > 100_000) throw new Error("Page text exceeds 100,000 characters. Nothing was truncated or saved.");
  return { title, text };
}

export async function readPublicPage(input: string) {
  let url = parsePublicUrl(input);
  const deadline = Date.now() + 15_000;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The page timed out. Try again later.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Website lookup timed out.")), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
      throw new Error("Private, local and reserved network addresses cannot be imported.");
    }
    const pinned = addresses[0];
    const result = await new Promise<{ redirect?: string; body?: string; plain?: boolean }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).get(url, {
        // Pin the checked DNS result to prevent DNS rebinding between lookup and connection.
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        family: pinned.family,
        headers: { "User-Agent": "StudyCoach-MaterialReader/1.0", Accept: "text/html,text/plain", "Accept-Encoding": "identity" },
      }, response => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          if (!response.headers.location) reject(new Error("Website redirect is missing its destination."));
          else resolve({ redirect: response.headers.location });
          return;
        }
        if (status !== 200) { response.resume(); reject(new Error(`Website returned ${status}; login pages and blocked pages are not bypassed.`)); return; }
        if (!/^text\/(html|plain)(;|$)/i.test(response.headers["content-type"] ?? "")) {
          response.resume(); reject(new Error("Only HTML or plain-text pages are supported. Use Files for documents.")); return;
        }
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          response.resume(); reject(new Error("The page uses an unsupported content encoding.")); return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { response.destroy(new Error("Page exceeds the 2 MB download limit. Nothing was saved.")); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), plain: response.headers["content-type"]?.startsWith("text/plain") }));
      });
      request.setTimeout(Math.max(1, deadline - Date.now()), () => request.destroy(new Error("Website timed out.")));
      const timeout = setTimeout(() => request.destroy(new Error("Website timed out.")), Math.max(1, deadline - Date.now()));
      request.on("close", () => clearTimeout(timeout));
      request.on("error", reject);
    });
    if (result.redirect) { url = parsePublicUrl(new URL(result.redirect, url).href); continue; }
    const { title, text } = result.plain ? { title: "", text: (result.body ?? "").trim() } : pageText(result.body ?? "");
    if (text.length < 40 || text.length > 100_000) throw new Error("Page text is empty, too short or exceeds 100,000 characters.");
    return { text, filename: title || url.hostname, sourceUrl: input, finalUrl: url.href };
  }
  throw new Error("Too many website redirects. Nothing was saved.");
}