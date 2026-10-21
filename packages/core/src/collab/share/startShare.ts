// Turns an existing project into a project share; the disk mirror then lists its files and settings in the index.
import type { Doc } from "yjs";
import { parseProjectFile, PROJECT_FILE, updateProjectFile, type ProjectReadContext } from "../../writing/project/index.js";
import { createProjectIndex } from "../model/index.js";

export interface StartShareRequest {
  folder: string;
  shareId: string;
  /** The new share's index doc. */
  index: Doc;
}

/**
 * Marks the index as a project's and writes `shared: <shareId>` into labshelf.yaml, keeping every other key and comment.
 * A project without a title gets its id as title, the name it shows already.
 */
export async function startShare({ fs, paths, logger }: ProjectReadContext, request: StartShareRequest): Promise<void> {
  const file = paths.join(request.folder, PROJECT_FILE);
  const text = await fs.readText(file);
  createProjectIndex(request.index);
  // `id` is per user and only `title` is shared, so without one a joiner's copy would get the slug fallback name.
  const parsed = parseProjectFile(text);
  const title = parsed.ok && parsed.settings.title === undefined ? { title: parsed.settings.id } : {};
  await fs.writeText(file, updateProjectFile(text, { ...title, shared: request.shareId }));
  await logger.log("INFO", "collab.share", "Shared a project", { folder: request.folder, shareId: request.shareId });
}
