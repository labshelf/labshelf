// Finds the writing project to build: the one named by the argument, else the one containing the working directory.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { PROJECT_FILE, type ILogger, type ProjectEntry } from "@labshelf/core";
import { listProjects, readProject } from "@labshelf/core/node";

import { UsageError } from "../usage.js";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

const exists = (target: string) => fs.stat(target).then(() => true, () => false);

async function enclosingProjectFolder(from: string): Promise<string | undefined> {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (await exists(path.join(dir, PROJECT_FILE))) { return dir; }
    if (path.dirname(dir) === dir) { return undefined; }
  }
}

async function entryFor(libraryRoot: string, logger: ILogger, argument: string, cwd: string): Promise<ProjectEntry> {
  const folder = path.resolve(cwd, argument);
  if (await exists(folder)) { return readProject(folder, "external", logger); }
  const byId = (await listProjects(libraryRoot, logger)).find((entry) => entry.kind === "ready" && entry.settings.id === argument);
  if (byId) { return byId; }
  throw new UsageError(`No project folder or project id "${argument}".`);
}

/**
 * @param argument a project folder or a project id; absent means the project containing `cwd`
 * @throws UsageError when no project is found or its labshelf.yaml cannot be read
 */
export async function findProject(libraryRoot: string, logger: ILogger, argument: string | undefined, cwd: string): Promise<ReadyProject> {
  let entry: ProjectEntry;
  if (argument !== undefined) {
    entry = await entryFor(libraryRoot, logger, argument, cwd);
  } else {
    const folder = await enclosingProjectFolder(cwd);
    if (!folder) { throw new UsageError(`No ${PROJECT_FILE} in ${cwd} or above. Run build inside a writing project or name one.`); }
    entry = await readProject(folder, "external", logger);
  }
  if (entry.kind === "broken") { throw new UsageError(`${entry.folder}: ${entry.reason}`); }
  return entry;
}
