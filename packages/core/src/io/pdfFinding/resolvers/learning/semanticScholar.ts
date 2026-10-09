/**
 * The Semantic Scholar Graph API (no key), valued for `externalIds` (arXiv, PubMed Central, ACL) and its open-access
 * link. The unauthenticated endpoint throttles hard, so there is one call per search, no retry, and a 429 is a soft
 * miss. The DOI keeps its slash in the path, because an encoded one is rate-limited too.
 */
import { encodeDoiPathSegment, normalizeArxivId, normalizePmcid, arxivIdFromUrl, pmcidFromUrl } from "../../../identifiers/index.js";
import { lookupJson } from "../timedFetch.js";
import type { PdfResolver, ResolveContext } from "../../types.js";
import { acceptRecord } from "./acceptRecord.js";
import { learnIds } from "./learnIds.js";

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
    const paper = await lookupJson<S2Paper>(env, `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=${FIELDS}`);
    if (!paper) return [];
    const authors = (paper.authors ?? []).map((a) => a.name ?? "").filter(Boolean);
    const record = { title: paper.title ?? undefined, year: paper.year ?? undefined, ...(authors.length ? { authors } : {}) };
    if (!acceptRecord("semantic-scholar", ctx, env, record)) return [];

    const ids = paper.externalIds ?? {};
    learnIds(ctx, { arxivId: normalizeArxivId(ids.ArXiv ?? ""), pmcid: normalizePmcid(ids.PubMedCentral ?? undefined) });
    const out: string[] = [];
    if (ids.ACL) out.push(`https://aclanthology.org/${aclId(ids.ACL)}.pdf`);
    const oa = paper.openAccessPdf?.url;
    const closed = (paper.openAccessPdf?.status ?? "").toUpperCase() === "CLOSED";
    if (oa && !closed && !arxivIdFromUrl(oa) && !pmcidFromUrl(oa)) out.push(oa);
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
