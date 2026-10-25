// Resolves a paper's bibliographic record from its registry record, page citation tags and a title search.
// Fields merge one by one, most trusted source first, so a registry missing the issue number keeps the page's.
import type { DetectedIdentifier, DetectedIds } from "../identifiers/index.js";
import { extractArxivIdentifierFromDoi } from "../identifiers/index.js";
import { mergeMetadata, SOURCE_TRUST, type MetadataSource, type ResolvedMetadata } from "../metadata/index.js";
import { fetchMetadataSourcesByDoi, resolveOnlineMetadata, searchOnlineByTitle } from "../search/index.js";
import type { RegistryEnv } from "../registries/index.js";
import { checkTitleAgreement } from "./titleAgreement.js";

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
  if (!ids.doi && merged.doi) ids.doi = merged.doi;
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
