// Looks up OpenAlex's record for a DOI or work id, proposing its publisher and repository copies and learning `pmcid` and `arxivId`.
import { arxivIdFromUrl, normalizePmcid, pmcidFromUrl } from "../../identifiers/index.js";
import { noteVersion, versionFromOaLabel } from "./candidateVersion.js";
import { lookupJson } from "./timedFetch.js";
import type { PdfResolver, ResolveContext, ResolverEnv } from "../pdfResolver.js";
import { acceptRecord } from "./matchPaper.js";
import { learnIds } from "./learnIds.js";

// TRAP: only the free single-work lookup is used; OpenAlex searches cost credits.

interface OpenAlexLocation {
  pdf_url?: string | null;
  landing_page_url?: string | null;
  is_oa?: boolean | null;
  source?: { type?: string | null } | null;
  version?: string | null;
}

interface OpenAlexWork {
  title?: string | null;
  publication_year?: number | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
  ids?: { pmcid?: string | null } | null;
  open_access?: { oa_url?: string | null } | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[] | null;
}

// Root fields only; OpenAlex rejects dotted paths such as best_oa_location.pdf_url.
const SELECT = "id,doi,title,publication_year,authorships,ids,open_access,best_oa_location,locations";
const RANK = { publisher: 40, openAccessUrl: 45, repository: 60 };

export const openalexResolver: PdfResolver = {
  name: "openalex",
  async resolve(ctx, env) {
    return ctx.doi ? openAlexCopies(ctx, env, `doi:${encodeURIComponent(ctx.doi)}`) : [];
  },
};

/**
 * Reads OpenAlex's single-work record and proposes its copies.
 * @param workRef the path segment naming the work: `doi:<encoded doi>` or an OpenAlex id ("W2626778328")
 * @returns Publisher and repository copies, none when the record is missing or is another paper's
 */
export async function openAlexCopies(ctx: ResolveContext, env: ResolverEnv, workRef: string): Promise<string[]> {
  const work = await lookupJson<OpenAlexWork>(
    env,
    `https://api.openalex.org/works/${workRef}?select=${SELECT}&mailto=${encodeURIComponent(ctx.contactEmail)}`,
  );
  if (!work) return [];
  const authors = (work.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean);
  const record = { title: work.title ?? undefined, year: work.publication_year ?? undefined, ...(authors.length ? { authors } : {}) };
  if (!acceptRecord("openalex", ctx, env, record)) return [];
  const locations = [work.best_oa_location, ...(work.locations ?? [])].filter((l): l is OpenAlexLocation => Boolean(l));
  learnIdentifiers(ctx, work, locations);
  for (const loc of locations) {
    const version = versionFromOaLabel(loc.version, isPublisherSource(loc));
    for (const url of [loc.pdf_url, loc.landing_page_url]) if (url) noteVersion(ctx, url, version);
  }
  return copiesOf(work, locations);
}

function learnIdentifiers(ctx: ResolveContext, work: OpenAlexWork, locations: OpenAlexLocation[]): void {
  const urls = locations.flatMap((l) => [l.landing_page_url, l.pdf_url]).filter((u): u is string => Boolean(u));
  learnIds(ctx, {
    pmcid: normalizePmcid(work.ids?.pmcid ?? undefined) ?? urls.map(pmcidFromUrl).find(Boolean),
    arxivId: urls.map(arxivIdFromUrl).find(Boolean),
  });
}

// OpenAlex types a location's source; journals, conferences and book platforms are the publisher's own site.
function isPublisherSource(loc: OpenAlexLocation): boolean {
  const type = (loc.source?.type ?? "").toLowerCase();
  return type !== "" && type !== "repository";
}

// PMC and arXiv copies are left to the resolvers that know how to fetch them.
function isHandledElsewhere(url: string): boolean {
  return pmcidFromUrl(url) !== undefined || arxivIdFromUrl(url) !== undefined;
}

function copiesOf(work: OpenAlexWork, locations: OpenAlexLocation[]): string[] {
  const direct: Array<{ url: string; rank: number }> = [];
  const landings: string[] = [];
  for (const loc of locations) {
    const repository = (loc.source?.type ?? "").toLowerCase() === "repository";
    const pdf = loc.pdf_url ?? undefined;
    if (pdf && !isHandledElsewhere(pdf)) direct.push({ url: pdf, rank: repository ? RANK.repository : RANK.publisher });
    const landing = loc.landing_page_url ?? undefined;
    if (loc.is_oa && !pdf && landing && !isHandledElsewhere(landing)) landings.push(landing);
  }
  const oaUrl = work.open_access?.oa_url ?? undefined;
  if (oaUrl && !isHandledElsewhere(oaUrl)) direct.push({ url: oaUrl, rank: RANK.openAccessUrl });
  direct.sort((a, b) => a.rank - b.rank);
  return [...new Set([...direct.map((d) => d.url), ...landings])];
}
