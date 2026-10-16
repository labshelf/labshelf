// Finds the project a file belongs to and the main-file path to store for it.
import * as path from "node:path";

import type { ProjectEntry } from "@labshelf/core/node";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The ready project whose folder contains the file; the deepest folder wins when projects are nested. */
export function owningProject(entries: readonly ProjectEntry[], filePath: string): ReadyProject | undefined {
  let owner: ReadyProject | undefined;
  for (const entry of entries) {
    if (entry.kind !== "ready" || !isInside(entry.folder, filePath)) { continue; }
    if (!owner || entry.folder.length > owner.folder.length) { owner = entry; }
  }
  return owner;
}

/** The file's path relative to the project folder, with "/" separators on every platform, as labshelf.yaml stores it. */
export function mainPathIn(project: ReadyProject, filePath: string): string {
  return path.relative(project.folder, filePath).split(path.sep).join("/");
}
