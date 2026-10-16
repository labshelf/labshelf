/** Indexes which writing projects cite each key, one entry per project file and section. */
import type { CitationSite } from "./citationSites.js";

/** One place a project cites a paper. */
export interface Backlink {
  project: string;
  /** Path relative to the project folder, "/"-separated. */
  file: string;
  /** Zero-based line of the first citation in this file and section. */
  line: number;
  section: string | undefined;
}

/** Cite key → the places that cite it, in the order they were added. */
export type BacklinkIndex = ReadonlyMap<string, readonly Backlink[]>;

/** Collects the sites of one file into the index; later citations in the same file and section add nothing. */
export function addBacklinks(
  index: Map<string, Backlink[]>, project: string, file: string, sites: readonly CitationSite[],
): void {
  for (const site of sites) {
    const links = index.get(site.key) ?? [];
    if (links.some((link) => link.project === project && link.file === file && link.section === site.section)) { continue; }
    links.push({ project, file, line: site.line, section: site.section });
    index.set(site.key, links);
  }
}
