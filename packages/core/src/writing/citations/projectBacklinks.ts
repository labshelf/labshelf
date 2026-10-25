// Builds the backlink index from the sources of every ready writing project.
import { DISK_ONLY, projectSources } from "./index.js";
import type { OpenSources, ProjectEntry } from "../project/index.js";
import type { ProjectReadContext } from "../project/folder/index.js";
import { addBacklinks, type Backlink, type BacklinkIndex } from "./backlinkEntries.js";
import { citationSites } from "./citationSites.js";

/** A project whose sources cannot be read is left out and logged, so one broken folder does not hide the rest. */
export async function projectBacklinks(
  context: ProjectReadContext, projects: readonly ProjectEntry[], open: OpenSources = DISK_ONLY,
): Promise<BacklinkIndex> {
  const index = new Map<string, Backlink[]>();
  for (const project of projects) {
    if (project.kind !== "ready") { continue; }
    const { id, format } = project.settings;
    try {
      for await (const source of projectSources(context, project.folder, format, open)) {
        addBacklinks(index, id, source.relative, citationSites(format, source.text));
      }
    } catch (error) {
      await context.logger.log("WARN", "backlinks", "project sources unreadable", { project: id, folder: project.folder, error: String(error) });
    }
  }
  return index;
}
