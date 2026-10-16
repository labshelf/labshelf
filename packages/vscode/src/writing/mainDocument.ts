// Finds the project a file belongs to and the main-file path to store for it.
import type { PathOps, ProjectEntry } from "@labshelf/core";

import type { WritingProjects } from "./session/index.js";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** The project list together with the path style its folders are written in. */
export type ProjectLookup = Pick<WritingProjects, "list" | "paths">;

/** Whether the file lies strictly inside the folder. */
export function isInside(paths: PathOps, folder: string, file: string): boolean {
  const relative = paths.relative(folder, file);
  return relative !== "" && !relative.startsWith("..") && !paths.isAbsolute(relative);
}

/** The ready project whose folder contains the file; the deepest folder wins when projects are nested. */
export function owningProject(projects: ProjectLookup, filePath: string): ReadyProject | undefined {
  let owner: ReadyProject | undefined;
  for (const entry of projects.list()) {
    if (entry.kind !== "ready" || !isInside(projects.paths, entry.folder, filePath)) { continue; }
    if (!owner || entry.folder.length > owner.folder.length) { owner = entry; }
  }
  return owner;
}

/** The file's path relative to the project folder, with "/" separators on every platform, as labshelf.yaml stores it. */
export function mainPathIn(paths: PathOps, project: ReadyProject, filePath: string): string {
  return paths.relative(project.folder, filePath).split(paths.sep).join("/");
}
