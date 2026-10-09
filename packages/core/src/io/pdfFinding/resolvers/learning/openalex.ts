/**
 * OpenAlex's record for a DOI: every known location (publisher, repository, PMC, arXiv) and the PMCID. The
 * single-work lookup is free; searches cost credits and are not used. Learns `pmcid` and `arxivId` for the
 * resolvers that follow, and proposes the publisher and repository copies itself.
 */
import { arxivIdFromUrl, normalizePmcid, pmcidFromUrl } from "../../../identifiers/index.js";
import { lookupJson } from "../timedFetch.js";
import type { PdfResolver, ResolveContext } from "../../types.js";
import { acceptRecord } from "./acceptRecord.js";
import { learnIds } from "./learnIds.js";

interface OpenAlexLocation {
  pdf_url?: string | null;
  landing_page_url?: string | null;
  is_oa?: boolean | null;
  source?: { type?: string | null } | null;
}

interface OpenAlexWork {
  title?: string | null;
  publication_year?: number | null;
  ids?: { pmcid?: string | null } | null;
  open_access?: { oa_url?: string | null } | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[] | null;
}

// Root fields only; OpenAlex rejects dotted paths such as best_oa_location.pdf_url.
const SELECT = "id,doi,title,publication_year,ids,open_access,best_oa_location,locations";
const RANK = { publisher: 40, openAccessUrl: 45, repository: 60 };

export const openalexResolver: PdfResolver = {
  name: "openalex",
  async resolve(ctx, env) {
    if (!ctx.doi) return [];
    const work = await lookupJson<OpenAlexWork>(
      env,
      `https://api.openalex.org/works/doi:${encodeURIComponent(ctx.doi)}?select=${SELECT}&mailto=${encodeURIComponent(ctx.contactEmail)}`,
    );
    if (!work) return [];
    const record = { title: work.title ?? undefined, year: work.publication_year ?? undefined };
    if (!acceptRecord("openalex", ctx, env, record)) return [];
    const locations = [work.best_oa_location, ...(work.locations ?? [])].filter((l): l is OpenAlexLocation => Boolean(l));
    learnIdentifiers(ctx, work, locations);
    return copiesOf(work, locations);
  },
};

function learnIdentifiers(ctx: ResolveContext, work: OpenAlexWork, locations: OpenAlexLocation[]): void {
  const urls = locations.flatMap((l) => [l.landing_page_url, l.pdf_url]).filter((u): u is string => Boolean(u));
  learnIds(ctx, {
    pmcid: normalizePmcid(work.ids?.pmcid ?? undefined) ?? urls.map(pmcidFromUrl).find(Boolean),
    arxivId: urls.map(arxivIdFromUrl).find(Boolean),
  });
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
