/** Proposes CrossRef's publisher-supplied "link" entries that are typed as PDF or end in .pdf. */
import { lookupJson } from "./timedFetch.js";
import type { PdfResolver } from "../pdfResolver.js";

interface CrossRefLink {
  URL?: string;
  "content-type"?: string;
  "intended-application"?: string;
}

interface CrossRefMessage {
  message?: { link?: CrossRefLink[] };
}

// Full-text for similarity checking and text mining is the most likely to be the whole article.
const INTENT_SCORE: Record<string, number> = { "similarity-checking": 3, "text-mining": 2, syndication: 1 };

export const crossrefResolver: PdfResolver = {
  name: "crossref",
  async resolve(ctx, env) {
    if (!ctx.doi) return [];
    const payload = await lookupJson<CrossRefMessage>(
      env,
      `https://api.crossref.org/works/${encodeURIComponent(ctx.doi)}`,
      { "User-Agent": `LabShelf/0.1 (mailto:${ctx.contactEmail})` },
    );
    const links = [...(payload?.message?.link ?? [])].filter((l): l is CrossRefLink & { URL: string } => Boolean(l.URL));
    const ranked = links.sort((a, b) => intentScore(b) - intentScore(a));
    const typed = ranked.filter((l) => (l["content-type"] ?? "").toLowerCase().includes("pdf"));
    // Some publishers list the PDF without a content-type.
    const bare = ranked.filter((l) => !typed.includes(l) && /\.pdf(?:[?#]|$)/i.test(l.URL));
    return [...typed, ...bare].map((l) => l.URL);
  },
};

function intentScore(link: CrossRefLink): number {
  return INTENT_SCORE[(link["intended-application"] ?? "").toLowerCase()] ?? 0;
}
