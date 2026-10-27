/** Settles which paper a page shows: merges its own fields with the registries' record and finds the library's copy. */
import type { PaperRecord } from "../../model/index.js";
import type { PageFacts } from "../landing/index.js";
import type { MetadataSource } from "../registries/index.js";
import { findInLibrary } from "./libraryMatch.js";
import { PAGE_TRUST, resolveMetadata, type MetadataDeps, type MetadataResult } from "./resolveMetadata.js";

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
