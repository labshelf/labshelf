/** Proposes copies from the identifier indexes (arXiv, CrossRef, Semantic Scholar) and records the identifiers a lookup reveals. */
import { encodeDoiPathSegment, normalizeArxivIdentifier, normalizePmcid, extractArxivIdentifierFromUrl, extractPmcidFromUrl } from "../identifiers/index.js";
import type { PdfResolver, ResolveContext } from "./finder.js";
import { matchWork } from "./matching.js";
import { fetchResolverJson } from "./hostPacer.js";

// --- arxiv: Builds arXiv's canonical PDF address, a fixed function of the id, so no lookup is needed.
export const arxivResolver: PdfResolver = {
  name: "arxiv",
  async resolve(ctx) {
    return ctx.arxivId ? [`https://arxiv.org/pdf/${ctx.arxivId}`] : [];
  },
};

// --- crossref: Proposes CrossRef's publisher-supplied "link" entries that are typed as PDF or end in .pdf.
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
    const payload = await fetchResolverJson<CrossRefMessage>(
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

// --- semanticScholar: Looks up the keyless Semantic Scholar Graph API for `externalIds` (arXiv, PMC, ACL) and the open-access link.
// TRAP: the unauthenticated endpoint throttles hard, so one call per search, no retry, and a 429 is a soft miss.
// The DOI keeps its slash in the path because an encoded one is rate-limited too.

interface S2Paper {
  title?: string | null;
  year?: number | null;
  authors?: Array<{ name?: string | null }> | null;
  openAccessPdf?: { url?: string | null; status?: string | null } | null;
  externalIds?: { ArXiv?: string | null; ACL?: string | null; PubMedCentral?: string | null } | null;
}

const FIELDS = "title,year,authors,externalIds,openAccessPdf";

export const semanticScholarResolver: PdfResolver = {
  name: "semantic-scholar",
  async resolve(ctx, env) {
    const id = paperId(ctx);
    if (!id) return [];
    const paper = await fetchResolverJson<S2Paper>(env, `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=${FIELDS}`);
    if (!paper) return [];
    const authors = (paper.authors ?? []).map((a) => a.name ?? "").filter(Boolean);
    const record = { title: paper.title ?? undefined, year: paper.year ?? undefined, ...(authors.length ? { authors } : {}) };
    if (!matchWork("semantic-scholar", ctx, env, record)) return [];

    const ids = paper.externalIds ?? {};
    addIdentifiers(ctx, { arxivId: normalizeArxivIdentifier(ids.ArXiv ?? ""), pmcid: normalizePmcid(ids.PubMedCentral ?? undefined) });
    const out: string[] = [];
    if (ids.ACL) out.push(`https://aclanthology.org/${aclId(ids.ACL)}.pdf`);
    const oa = paper.openAccessPdf?.url;
    const closed = (paper.openAccessPdf?.status ?? "").toUpperCase() === "CLOSED";
    if (oa && !closed && !extractArxivIdentifierFromUrl(oa) && !extractPmcidFromUrl(oa)) out.push(oa);
    return out;
  },
};

function paperId(ctx: ResolveContext): string | undefined {
  if (ctx.doi) return `DOI:${encodeDoiPathSegment(ctx.doi)}`;
  if (ctx.arxivId) return `ARXIV:${ctx.arxivId}`;
  if (ctx.pmid) return `PMID:${ctx.pmid}`;
  return undefined;
}

// Old-style ACL ids (N19-1423) are case-sensitive on aclanthology.org and must be upper-cased;
// new-style ids (2020.acl-main.1) stay as given.
function aclId(id: string): string {
  return /^[a-z]\d{2}-\d{4}$/i.test(id) ? id.toUpperCase() : id;
}

// --- addIdentifiers: Records identifiers a lookup revealed on the context, never overwriting one the context already had.
export function addIdentifiers(ctx: ResolveContext, found: { pmcid?: string | undefined; arxivId?: string | undefined }): void {
  if (!ctx.pmcid && found.pmcid) ctx.pmcid = found.pmcid;
  if (!ctx.arxivId && found.arxivId) ctx.arxivId = found.arxivId;
}
