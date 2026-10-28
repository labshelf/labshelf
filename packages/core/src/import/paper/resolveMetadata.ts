// Resolves a paper's bibliographic record from its registry record, page citation tags and a title search.
// Fields merge one by one, most trusted source first, so a registry missing the issue number keeps the page's.
import { BIBLIOGRAPHIC_FIELDS, type PaperRecord } from "../../model/index.js";
import type { DetectedIdentifier, DetectedIds } from "../identifiers/index.js";
import { extractArxivIdentifierFromDoi, extractArxivIdentifierFromUrl, extractDoi, extractPmidFromUrl, toDoi } from "../identifiers/index.js";
import type { PageFacts } from "../htmlPage.js";
import {
  mergeMetadata,
  SOURCE_TRUST,
  fetchMetadataSourcesByDoi,
  resolveOnlineMetadata,
  searchOnlineByTitle,
  type MetadataSource,
  type ResolvedMetadata,
  type RegistryEnv,
} from "../registries/index.js";
import { checkTitleAgreement, findInLibrary } from "../samePaper.js";

/** How much a page's own tags are trusted: below the registry, above a title search. */
export const PAGE_TRUST = { structured: 80, titleOnly: 25 } as const;

/** Where the winning record came from, for the UI and the log. */
export type MetadataOrigin = "registry" | "search" | "page" | "none";

export interface MetadataResult {
  metadata: ResolvedMetadata;
  ids: DetectedIds;
  origin: MetadataOrigin;
}

export interface MetadataInput {
  ids: DetectedIds;
  /** Fields from the page (or Scholar result) and how much to trust them. */
  sources: MetadataSource[];
}

/** The online lookups, replaceable by tests and by hosts with their own network access. */
export interface MetadataDeps {
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
  searchByTitle?: (title: string) => Promise<ResolvedMetadata | undefined>;
  enrich?: (doi: string) => Promise<MetadataSource[]>;
  /** What the default lookups run on, so a registry failure reaches the app's log. */
  registry?: RegistryEnv;
}

/** @returns the merged record, the identifiers it revealed and where the winning record came from */
export async function resolveMetadata(input: MetadataInput, deps: MetadataDeps = {}): Promise<MetadataResult> {
  const searchByTitle = deps.searchByTitle ?? ((title: string) => searchOnlineByTitle(title, deps.registry));
  const ids: DetectedIds = { ...input.ids };
  const sources = [...input.sources];
  let origin: MetadataOrigin = sources.some((s) => s.metadata?.title) ? "page" : "none";

  const registry = await registryRecord(ids, deps.resolveIdentifier ?? ((id) => resolveOnlineMetadata(id, deps.registry)));
  if (registry?.title) {
    sources.push({ name: "registry", trust: SOURCE_TRUST.confirmedIdentifier, metadata: registry });
    origin = "registry";
  } else {
    const best = bestPageRecord(input.sources);
    const found = best?.title ? await searchByTitle(best.title).catch(() => undefined) : undefined;
    if (found && checkTitleAgreement(found, best!)) {
      sources.push({ name: "search", trust: SOURCE_TRUST.search, metadata: found });
      origin = "search";
    }
  }

  const merged = mergeMetadata(sources).metadata;
  const keywords = sources.sort((a, b) => b.trust - a.trust).find((s) => s.metadata?.keywords?.length)?.metadata?.keywords;
  if (keywords?.length) merged.keywords = keywords;
  const mergedDoi = merged.doi ? toDoi(merged.doi) : undefined;
  if (!ids.doi && mergedDoi) ids.doi = mergedDoi;
  if (!ids.arxivId) {
    const arxivId = extractArxivIdentifierFromDoi(merged.doi);
    if (arxivId) ids.arxivId = arxivId;
  }
  return { metadata: merged, ids, origin };
}

/**
 * Fills a missing abstract from the registries that keep one (Semantic Scholar, Europe PMC). Bounded in time,
 * because it runs while the user waits.
 */
export async function withAbstract(metadata: ResolvedMetadata, deps: MetadataDeps = {}, timeoutMs = 6000): Promise<ResolvedMetadata> {
  if (metadata.summary || !metadata.doi) return metadata;
  const enrich = deps.enrich ?? ((doi: string) => fetchMetadataSourcesByDoi(doi, deps.registry));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const extra = await Promise.race([
    enrich(metadata.doi).catch((): MetadataSource[] => []),
    new Promise<MetadataSource[]>((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); }),
  ]);
  clearTimeout(timer);
  const summary = extra.find((s) => s.metadata?.summary)?.metadata?.summary;
  return summary ? { ...metadata, summary } : metadata;
}

async function registryRecord(
  ids: DetectedIds,
  resolve: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>,
): Promise<ResolvedMetadata | undefined> {
  const tries: DetectedIdentifier[] = [];
  // A journal DOI describes the published version; an arXiv DOI only the preprint.
  if (ids.doi && !extractArxivIdentifierFromDoi(ids.doi)) tries.push({ type: "doi", value: ids.doi });
  if (ids.arxivId) tries.push({ type: "arxiv", value: ids.arxivId });
  if (ids.pmid) tries.push({ type: "pmid", value: ids.pmid });
  for (const id of tries) {
    const record = await resolve(id).catch(() => undefined);
    if (record?.title) return record;
  }
  return undefined;
}

function bestPageRecord(sources: MetadataSource[]): ResolvedMetadata | undefined {
  return [...sources].sort((a, b) => b.trust - a.trust).find((s) => s.metadata?.title)?.metadata;
}

// Stored records: the bibliographic fields and identifiers a paper record states, in the shape metadata resolution and PDF finding read.

export function deriveResolvedMetadata(r: PaperRecord): ResolvedMetadata {
  const metadata: ResolvedMetadata = { title: r.title };
  for (const field of BIBLIOGRAPHIC_FIELDS) {
    const value = r[field];
    if (value !== undefined) Object.assign(metadata, { [field]: value });
  }
  return metadata;
}


/** @returns the record's DOI, the arXiv id named by an arXiv DOI or an arxiv.org URL, and a PMID in a PubMed URL */
export function extractPaperIdentifiers(r: Pick<PaperRecord, "doi" | "url">): DetectedIds {
  const doi = extractDoi(r.doi);
  const arxivId = extractArxivIdentifierFromDoi(r.doi) ?? (r.url ? extractArxivIdentifierFromUrl(r.url) : undefined);
  const pmid = r.url ? extractPmidFromUrl(r.url) : undefined;
  return {
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pmid ? { pmid } : {}),
  };
}

// A page's paper: merges the page's own fields with the registries' record and finds the library's copy.


export interface PagePaper extends MetadataResult {
  /** The page names a paper, or a registry or title search recognised what it states. */
  isPaper: boolean;
  /** The library's copy, when the paper is already there. */
  existing?: PaperRecord;
}

export interface PagePaperOptions {
  /** Sources besides the page, such as a Scholar result's own line. */
  extraSources?: MetadataSource[];
  deps?: MetadataDeps;
}

/**
 * A page that is not a paper and brings no other source is not looked up: its title alone would send a title search
 * after any web page.
 * @returns the resolved record; `records` is read only for a paper
 */
export async function resolvePagePaper(
  facts: PageFacts,
  records: () => PaperRecord[] | Promise<PaperRecord[]>,
  options: PagePaperOptions = {},
): Promise<PagePaper> {
  const extraSources = options.extraSources ?? [];
  const pageSource: MetadataSource = {
    name: "page",
    trust: facts.structured ? PAGE_TRUST.structured : PAGE_TRUST.titleOnly,
    metadata: facts.metadata,
  };
  const resolved = facts.isPaper || extraSources.length
    ? await resolveMetadata({ ids: facts.ids, sources: [pageSource, ...extraSources] }, options.deps)
    : { metadata: facts.metadata, ids: facts.ids, origin: "none" as const };
  const isPaper = facts.isPaper || resolved.origin === "registry" || resolved.origin === "search";
  const existing = isPaper
    ? findInLibrary(await records(), { ...resolved.ids, title: resolved.metadata.title, year: resolved.metadata.year })
    : undefined;
  return { ...resolved, isPaper, ...(existing ? { existing } : {}) };
}
