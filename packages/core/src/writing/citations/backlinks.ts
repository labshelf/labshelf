/** Finds which writing projects cite each key: the backlink index built from a project's sources. */

import type { OpenSources, ProjectEntry, ProjectReadContext } from "../project/index.js";
import { findCitationSites, type CitationSite } from "./citeKeys.js";
import { DISK_ONLY, walkProjectSources } from "./projectSources.js";

// --- Backlink index ---

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
export type BacklinkMap = ReadonlyMap<string, readonly Backlink[]>;

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

/** A project whose sources cannot be read is left out and logged, so one broken folder does not hide the rest. */
export async function deriveProjectBacklinks(
  context: ProjectReadContext, projects: readonly ProjectEntry[], open: OpenSources = DISK_ONLY,
): Promise<BacklinkMap> {
  const index = new Map<string, Backlink[]>();
  for (const project of projects) {
    if (project.kind !== "ready") { continue; }
    const { id, format } = project.settings;
    try {
      for await (const source of walkProjectSources(context, project.folder, format, open)) {
        addBacklinks(index, id, source.relative, findCitationSites(format, source.text));
      }
    } catch (error) {
      await context.logger.log("WARN", "backlinks", "project sources unreadable", { project: id, folder: project.folder, error: String(error) });
    }
  }
  return index;
}
