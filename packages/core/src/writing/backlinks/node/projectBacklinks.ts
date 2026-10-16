/** Builds the backlink index from the sources of every ready writing project. */
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { DISK_ONLY, projectSources, type OpenSources } from "../../citations/node/index.js";
import type { ProjectEntry } from "../../project/node/index.js";
import { addBacklinks, type Backlink, type BacklinkIndex } from "../backlinkIndex.js";
import { citationSites } from "../citationSites.js";

/** A project whose sources cannot be read is left out and logged, so one broken folder does not hide the rest. */
export async function projectBacklinks(
  projects: readonly ProjectEntry[], logger: ILogger, open: OpenSources = DISK_ONLY,
): Promise<BacklinkIndex> {
  const index = new Map<string, Backlink[]>();
  for (const project of projects) {
    if (project.kind !== "ready") { continue; }
    const { id, format } = project.settings;
    try {
      for await (const source of projectSources(project.folder, format, open)) {
        const file = path.relative(project.folder, source.file).split(path.sep).join("/");
        addBacklinks(index, id, file, citationSites(format, source.text));
      }
    } catch (error) {
      await logger.log("WARN", "backlinks", "project sources unreadable", { project: id, folder: project.folder, error: String(error) });
    }
  }
  return index;
}
