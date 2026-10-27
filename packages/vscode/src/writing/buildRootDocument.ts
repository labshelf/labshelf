// Finds the project a file belongs to and the main-file path to store for it.
import { isInside, type PathOps, type ProjectEntry } from "@labshelf/core";

import type { WritingProjects } from "./session/index.js";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** The project list together with the path style its folders are written in. */
export type ProjectFinder = Pick<WritingProjects, "list" | "paths">;

/** The ready project whose folder contains the file; the deepest folder wins when projects are nested. */
export function findOwningProject(projects: ProjectFinder, filePath: string): ReadyProject | undefined {
  let owner: ReadyProject | undefined;
  for (const entry of projects.list()) {
    if (entry.kind !== "ready" || !isInside(projects.paths, entry.folder, filePath)) { continue; }
    if (!owner || entry.folder.length > owner.folder.length) { owner = entry; }
  }
  return owner;
}

/** The file's path relative to the project folder, with "/" separators on every platform, as labshelf.yaml stores it. */
export function deriveBuildRootPath(paths: PathOps, project: ReadyProject, filePath: string): string {
  return paths.relative(project.folder, filePath).split(paths.sep).join("/");
}

/** A project-relative `/`-separated path; a file outside the project keeps its own path. */
export function deriveProjectPath(paths: PathOps, folder: string, file: string): string {
  return (isInside(paths, folder, file, { allowEqual: true }) ? paths.relative(folder, file) : file).split(paths.sep).join("/");
}
