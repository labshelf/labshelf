// Creates the library project a member joins a project share into, before the disk mirror fills it.
import type { Doc } from "yjs";
import { createLibraryLayout } from "../../library/index.js";
import { claimProjectId, PROJECT_FILE, type ProjectCatalogContext } from "../../writing/project/index.js";
import { applySharedSettings, indexSettings, readIndexKind, readSettingsMap } from "../model/index.js";

export interface JoinShareRequest {
  libraryRoot: string;
  shareId: string;
  /** The share's index doc, synced far enough to hold its kind and settings. */
  index: Doc;
}

export interface JoinedProject {
  id: string;
  folder: string;
}

/**
 * Creates `projects/<id>/` with a labshelf.yaml of the shared settings plus this member's `id` and `shared`, the id
 * taken from the shared title with the usual suffix on a collision. Throws for a share that is not a project.
 */
export async function joinShare(context: ProjectCatalogContext, request: JoinShareRequest): Promise<JoinedProject> {
  const { fs, paths, logger } = context;
  const kind = readIndexKind(request.index);
  if (!kind.ok) {
    throw new Error(kind.error === "missingShareKind" ? "The share names no kind" : `The share is a ${String(kind.kind)}, not a project`);
  }
  const settings = readSettingsMap(indexSettings(request.index));
  const title = typeof settings["title"] === "string" ? settings["title"] : "project";
  const id = await claimProjectId(context, request.libraryRoot, title);
  const folder = paths.join(createLibraryLayout(request.libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot(), id);
  // INVARIANT: id and shareId are a slug and hex, so they need no YAML quoting.
  await fs.writeText(paths.join(folder, PROJECT_FILE), applySharedSettings(`id: ${id}\nshared: ${request.shareId}\n`, settings));
  await logger.log("INFO", "collab.share", "Created the project of a joined share", { folder, shareId: request.shareId });
  return { id, folder };
}
