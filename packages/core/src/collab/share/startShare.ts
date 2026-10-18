// Turns an existing project into a project share; the disk mirror then lists its files and settings in the index.
import type { Doc } from "yjs";
import { PROJECT_FILE, updateProjectFile, type ProjectReadContext } from "../../writing/project/index.js";
import { createProjectIndex } from "../model/index.js";

export interface StartShareRequest {
  folder: string;
  shareId: string;
  /** The new share's index doc. */
  index: Doc;
}

/** Marks the index as a project's and writes `shared: <shareId>` into labshelf.yaml, keeping every other key and comment. */
export async function startShare({ fs, paths, logger }: ProjectReadContext, request: StartShareRequest): Promise<void> {
  const file = paths.join(request.folder, PROJECT_FILE);
  const text = await fs.readText(file);
  createProjectIndex(request.index);
  await fs.writeText(file, updateProjectFile(text, { shared: request.shareId }));
  await logger.log("INFO", "collab.share", "Shared a project", { folder: request.folder, shareId: request.shareId });
}
