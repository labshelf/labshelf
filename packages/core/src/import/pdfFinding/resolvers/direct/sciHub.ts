/** Sci-Hub, only for a user who opted in by configuring a mirror. Mirror markup shifts, so any surprise is a soft miss. */
import { timedFetch } from "../timedFetch.js";
import type { PdfResolver } from "../../types.js";

// Common embed markup: <embed src>, <iframe src>, location.href = "...", a download anchor.
const EMBEDDED_PDF = [
  /<embed[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
  /<iframe[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
  /location\.href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
  /<a[^>]+href\s*=\s*["']([^"']+\.pdf[^"']*)["'][^>]*>(?:[^<]*?download)/i,
];

export const sciHubResolver: PdfResolver = {
  name: "sci-hub",
  async resolve(ctx, env) {
    if (!ctx.sciHubMirror || !ctx.doi) return [];
    const mirror = ctx.sciHubMirror.replace(/\/+$/, "");
    const pageUrl = `${mirror}/${ctx.doi}`;
    const page = await timedFetch(env, pageUrl, async (res) => {
      // Some mirrors serve the PDF directly under /<doi> when they have it cached.
      if ((res.headers.get("content-type") ?? "").toLowerCase().includes("pdf")) return { directUrl: res.url || pageUrl };
      return { html: await res.text() };
    });
    if (!page) return [];
    if (page.directUrl) return [page.directUrl];
    for (const pattern of EMBEDDED_PDF) {
      const raw = pattern.exec(page.html ?? "")?.[1];
      if (raw) return [absoluteUrl(raw, mirror)];
    }
    return [];
  },
};

// Sci-Hub answers protocol-relative ("//host/path.pdf") and root-relative ("/path.pdf") URLs.
function absoluteUrl(raw: string, mirror: string): string {
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw.startsWith("/") ? `${mirror}${raw}` : raw;
}
