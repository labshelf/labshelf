/** Proposes copies from the open-access services and publisher URL schemes: Unpaywall, PMC, Europe PMC, OpenAlex, the publisher rule table and custom resolvers. */
import { extractArxivIdentifierFromUrl, normalizePmcid, extractPmcidFromUrl } from "../identifiers/index.js";
import { reportWarning, type PdfResolver, type ResolveContext, type ResolverEnv } from "./finder.js";
import { listPdfUrlsForDoi, listPdfUrlsForLanding } from "./rules.js";
import { addIdentifiers } from "./indexes.js";
import { addVersion, deriveVersionFromOaLabel, matchWork } from "./matching.js";
import { fetchResolverJson, fetchResolverText } from "./hostPacer.js";

// --- unpaywall: Proposes the legal open-access copies (publisher, repository, preprint server) Unpaywall lists for a DOI.
interface UnpaywallLocation {
  url_for_pdf?: string | null;
  url?: string | null;
  host_type?: string | null;
  version?: string | null;
}

interface UnpaywallResponse {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

const HOST_RANK: Record<string, number> = { publisher: 2, repository: 1 };

export const unpaywallResolver: PdfResolver = {
  name: "unpaywall",
  async resolve(ctx, env) {
    if (!ctx.doi) return [];
    const payload = await fetchResolverJson<UnpaywallResponse>(
      env,
      `https://api.unpaywall.org/v2/${encodeURIComponent(ctx.doi)}?email=${encodeURIComponent(ctx.contactEmail)}`,
    );
    if (!payload) return [];
    for (const loc of [payload.best_oa_location, ...(payload.oa_locations ?? [])]) {
      const version = deriveVersionFromOaLabel(loc?.version, (loc?.host_type ?? "").toLowerCase() === "publisher");
      if (loc?.url_for_pdf) addVersion(ctx, loc.url_for_pdf, version);
      if (loc?.url) addVersion(ctx, loc.url, version);
    }
    const out: string[] = [];
    if (payload.best_oa_location?.url_for_pdf) out.push(payload.best_oa_location.url_for_pdf);
    const others = [...(payload.oa_locations ?? [])].sort((a, b) => hostRank(b) - hostRank(a));
    for (const loc of others) {
      if (loc.url_for_pdf) out.push(loc.url_for_pdf);
      else if (loc.url && /\.pdf(?:[?#]|$)/i.test(loc.url)) out.push(loc.url);
    }
    return [...new Set(out)];
  },
};

function hostRank(location: UnpaywallLocation): number {
  return HOST_RANK[(location.host_type ?? "").toLowerCase()] ?? 0;
}

// --- pmc: Proposes PMC PDFs from the open-data bucket on AWS, which skips the bot check that guards pmc.ncbi.nlm.nih.gov.
const S3_BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com";

export const pmcResolver: PdfResolver = {
  name: "pmc",
  async resolve(ctx, env) {
    const pmcid = normalizePmcid(ctx.pmcid);
    if (!pmcid) return [];
    // The key carries a version, so it is discovered with a cheap listing.
    // The trailing dot in the prefix is required, or "PMC118" also lists "PMC1180...".
    const xml = await fetchResolverText(env, `${S3_BUCKET}/?list-type=2&prefix=${pmcid}.&max-keys=100`);
    const key = xml ? latestPdfKey(xml, pmcid) : undefined;
    return key ? [`${S3_BUCKET}/${key}`] : [];
  },
};

// Keys look like "PMC1182327.2/PMC1182327.2.pdf"; the highest version is the latest.
function latestPdfKey(xml: string, pmcid: string): string | undefined {
  const keys = new RegExp(`<Key>(${pmcid}\\.(\\d+)/${pmcid}\\.\\d+\\.pdf)</Key>`, "g");
  let best: { key: string; version: number } | undefined;
  for (const match of xml.matchAll(keys)) {
    const version = Number(match[2]);
    if (match[1] && (!best || version > best.version)) best = { key: match[1], version };
  }
  return best?.key;
}

// --- europePmc: Looks up the Europe PMC REST API for the PMCID and non-Europe-PMC full-text links.
// TRAP: Europe PMC's own PDF endpoints sit behind a bot check, so PMC copies are left to the PMC resolver.
// A record is accepted only when its DOI equals the one asked for, because Europe PMC maps some DOIs to unrelated papers.

interface EpmcResult {
  pmcid?: string | null;
  doi?: string | null;
  title?: string | null;
  pubYear?: string | null;
  inPMC?: string | null;
  inEPMC?: string | null;
  fullTextUrlList?: { fullTextUrl?: Array<{ documentStyle?: string | null; site?: string | null; url?: string | null }> } | null;
}

const SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export const europePmcResolver: PdfResolver = {
  name: "europepmc",
  async resolve(ctx, env) {
    const query = buildQuery(ctx);
    if (!query) return [];
    const payload = await fetchResolverJson<{ resultList?: { result?: EpmcResult[] } | null }>(
      env,
      `${SEARCH}?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=3`,
    );
    const results = payload?.resultList?.result ?? [];
    const result = results.find((r) => !ctx.doi || (r.doi ?? "").toLowerCase() === ctx.doi.toLowerCase());
    if (!result) {
      if (results.length) reportWarning(env, "no result carries the searched DOI", { query, found: results.map((r) => r.doi ?? null) });
      return [];
    }
    const year = Number(result.pubYear);
    const record = { title: result.title ?? undefined, ...(Number.isNaN(year) || !result.pubYear ? {} : { year }) };
    if (!matchWork("europepmc", ctx, env, record)) return [];

    const inPmc = result.inPMC === "Y" || result.inEPMC === "Y";
    addIdentifiers(ctx, { pmcid: inPmc && result.pmcid ? result.pmcid.toUpperCase() : undefined });
    const links = result.fullTextUrlList?.fullTextUrl ?? [];
    const pdfs = links.filter((l) => l.site !== "Europe_PMC" && (l.documentStyle ?? "").toLowerCase() === "pdf" && l.url);
    return [...new Set(pdfs.map((l) => l.url as string))];
  },
};

function buildQuery(ctx: ResolveContext): string | undefined {
  if (ctx.doi) return `DOI:"${ctx.doi}"`;
  if (ctx.pmcid) return `PMCID:${ctx.pmcid.toUpperCase()}`;
  if (ctx.pmid) return `EXT_ID:${ctx.pmid} AND SRC:MED`;
  return undefined;
}

// --- openalex: Looks up OpenAlex's record for a DOI or work id, proposing its publisher and repository copies and learning `pmcid` and `arxivId`.
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
  const work = await fetchResolverJson<OpenAlexWork>(
    env,
    `https://api.openalex.org/works/${workRef}?select=${SELECT}&mailto=${encodeURIComponent(ctx.contactEmail)}`,
  );
  if (!work) return [];
  const authors = (work.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean);
  const record = { title: work.title ?? undefined, year: work.publication_year ?? undefined, ...(authors.length ? { authors } : {}) };
  if (!matchWork("openalex", ctx, env, record)) return [];
  const locations = [work.best_oa_location, ...(work.locations ?? [])].filter((l): l is OpenAlexLocation => Boolean(l));
  learnIdentifiers(ctx, work, locations);
  for (const loc of locations) {
    const version = deriveVersionFromOaLabel(loc.version, isPublisherSource(loc));
    for (const url of [loc.pdf_url, loc.landing_page_url]) if (url) addVersion(ctx, url, version);
  }
  return copiesOf(work, locations);
}

function learnIdentifiers(ctx: ResolveContext, work: OpenAlexWork, locations: OpenAlexLocation[]): void {
  const urls = locations.flatMap((l) => [l.landing_page_url, l.pdf_url]).filter((u): u is string => Boolean(u));
  addIdentifiers(ctx, {
    pmcid: normalizePmcid(work.ids?.pmcid ?? undefined) ?? urls.map(extractPmcidFromUrl).find(Boolean),
    arxivId: urls.map(extractArxivIdentifierFromUrl).find(Boolean),
  });
}

// OpenAlex types a location's source; journals, conferences and book platforms are the publisher's own site.
function isPublisherSource(loc: OpenAlexLocation): boolean {
  const type = (loc.source?.type ?? "").toLowerCase();
  return type !== "" && type !== "repository";
}

// PMC and arXiv copies are left to the resolvers that know how to fetch them.
function isHandledElsewhere(url: string): boolean {
  return extractPmcidFromUrl(url) !== undefined || extractArxivIdentifierFromUrl(url) !== undefined;
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

// --- publisher: Proposes the publisher's own PDF URLs that the rule table builds from the landing page and the DOI.
// Without institutional access these URLs land on a login page, which the downloader classifies as "login".
export const publisherResolver: PdfResolver = {
  name: "publisher",
  async resolve(ctx) {
    return [
      ...(ctx.landingUrl ? listPdfUrlsForLanding(ctx.landingUrl) : []),
      ...(ctx.doi ? listPdfUrlsForDoi(ctx.doi) : []),
    ];
  },
};

// --- customResolver: Proposes the address each enabled custom resolver builds from the DOI; the downloader reads the page it answers with.
/** A template is usable when it is an http(s) address with a `{doi}` placeholder. */
export function isCustomResolverTemplate(template: string): boolean {
  return /^https?:\/\/\S+$/i.test(template) && template.includes("{doi}");
}

export const customResolver: PdfResolver = {
  name: "custom",
  async resolve(ctx) {
    const { doi } = ctx;
    if (!doi) return [];
    return (ctx.customResolvers ?? []).filter((r) => r.enabled).map((r) => r.template.replace("{doi}", doi));
  },
};
