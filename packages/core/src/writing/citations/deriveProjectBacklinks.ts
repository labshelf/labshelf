// Builds the backlink index from the sources of every ready writing project.
import { DISK_ONLY, walkProjectSources } from "./index.js";
import type { OpenSources, ProjectEntry } from "../project/index.js";
import type { ProjectReadContext } from "../project/folder/index.js";
import { addBacklinks, type Backlink, type BacklinkMap } from "./backlinkEntries.js";
import { findCitationSites } from "./findCitationSites.js";

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
