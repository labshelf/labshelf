/** The PDF links a page offers, ranked: the page itself, embedded viewers, citation_pdf_url, alternates, then own anchors. */
import type { DetectedIds } from "../identifiers/index.js";
import type { PdfCandidate, RawPage } from "./types.js";

// Links whose URL says they are not the article itself.
const NOT_THE_ARTICLE = /supp|suppl|supplement|appendix|figure|poster|slides|review_history|license|terms|guide|instruction|author-?info|policy|catalog|brochure/i;
const MAX_ANCHOR_CANDIDATES = 4;

export function pdfCandidatesOf(raw: RawPage, metaPdfUrls: string[], ids: DetectedIds): PdfCandidate[] {
  const out: PdfCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined): void => {
    if (!url) return;
    let abs: string;
    try { abs = new URL(url, raw.pageUrl).href; } catch { return; }
    if (!/^https?:/.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, source: "page" });
  };

  if (raw.pageIsPdf) add(raw.pageUrl);
  raw.pdfLinks.filter((l) => l.kind === "embed").forEach((l) => add(l.url));
  metaPdfUrls.forEach(add);
  raw.pdfLinks.filter((l) => l.kind === "alternate").forEach((l) => add(l.url));

  // Plain anchors are a weaker signal: keep the ones that name this paper or sit
  // on the publisher's own host, never ones that are plainly something else.
  const host = hostOf(raw.pageUrl);
  const own = [ids.doi, ids.arxivId].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  raw.pdfLinks
    .filter((l) => l.kind === "labelled" || l.kind === "href")
    .filter((l) => !NOT_THE_ARTICLE.test(l.url))
    .filter((l) => own.some((id) => safeDecode(l.url).toLowerCase().includes(id)) || hostOf(l.url) === host)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "labelled" ? -1 : 1))
    .slice(0, MAX_ANCHOR_CANDIDATES)
    .forEach((l) => add(l.url));
  return out;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

function safeDecode(url: string): string {
  try { return decodeURIComponent(url); } catch { return url; }
}
