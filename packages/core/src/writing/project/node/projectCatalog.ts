/** Lists, creates and registers the writing projects of a library: its own projects/ folders and registered folders. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { claimCiteKey, joinWith, libraryLayout } from "../../../library/index.js";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { PROJECT_FILE, parseProjectFile, serializeProjectFile, type ProjectFormat } from "../projectFile.js";
import { projectIdSlug } from "../projectId.js";
import { projectTemplate } from "../templates.js";
import { readProject, type ProjectEntry } from "./projectFolder.js";
import { loadProjectRegistry, registerProjectFolder } from "./projectRegistryFile.js";

function projectsRoot(libraryRoot: string): string {
  return libraryLayout(libraryRoot, joinWith(path.sep as "/" | "\\")).projectsRoot();
}

async function libraryProjectFolders(libraryRoot: string): Promise<string[]> {
  const root = projectsRoot(libraryRoot);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => path.join(root, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
    throw error;
  }
}

/** The library's own projects, then the registered folders in the order they were added. */
export async function listProjects(libraryRoot: string, logger: ILogger): Promise<ProjectEntry[]> {
  const own = await Promise.all((await libraryProjectFolders(libraryRoot)).map((folder) => readProject(folder, "library", logger)));
  const registry = await loadProjectRegistry(libraryRoot, logger);
  const external = await Promise.all(registry.folders.map((folder) => readProject(folder, "external", logger)));
  return [...own, ...external];
}

// INVARIANT: project ids are unique across the library and the registry, because the build cache is keyed by id.
async function claimProjectId(libraryRoot: string, title: string, logger: ILogger): Promise<string> {
  const ids = (await listProjects(libraryRoot, logger)).flatMap((entry) => entry.kind === "ready" ? [entry.settings.id] : []);
  const root = projectsRoot(libraryRoot);
  const folderExists = (id: string) => fs.stat(path.join(root, id)).then(() => true, () => false);
  return claimCiteKey(projectIdSlug(title), ids, folderExists);
}

/** Creates <library>/projects/<id>/ with labshelf.yaml and the template main file. */
export async function createProject(
  libraryRoot: string,
  request: { title: string; format: ProjectFormat },
  logger: ILogger,
): Promise<ProjectEntry> {
  const id = await claimProjectId(libraryRoot, request.title, logger);
  const folder = path.join(projectsRoot(libraryRoot), id);
  const template = projectTemplate(request.format, request.title);
  // Non-recursive on the project folder itself: a folder that appeared since the id was claimed is never reused.
  await fs.mkdir(projectsRoot(libraryRoot), { recursive: true });
  await fs.mkdir(folder);
  await writeFileAtomic(path.join(folder, template.main), template.text);
  await writeFileAtomic(path.join(folder, PROJECT_FILE), serializeProjectFile({ id, format: request.format, main: template.main }));
  await logger.log("INFO", "project", "project created", { folder, format: request.format });
  return readProject(folder, "library", logger);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Registers a folder outside the library. Writes labshelf.yaml only when the folder has none, and never touches
 * anything else in it (its git repository included).
 */
export async function addExistingFolder(
  libraryRoot: string,
  request: { folder: string; format: ProjectFormat },
  logger: ILogger,
): Promise<ProjectEntry> {
  const folder = path.resolve(request.folder);
  if (isInside(path.resolve(libraryRoot), folder)) {
    throw new Error(`${folder} is inside the library; create the project with New project instead`);
  }
  const file = path.join(folder, PROJECT_FILE);
  const existing = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return undefined; }
    throw error;
  });
  if (existing === undefined) {
    const id = await claimProjectId(libraryRoot, path.basename(folder), logger);
    await writeFileAtomic(file, serializeProjectFile({ id, format: request.format }));
  } else {
    const parsed = parseProjectFile(existing);
    if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
    const clash = (await listProjects(libraryRoot, logger)).find((entry) =>
      entry.kind === "ready" && entry.folder !== folder && entry.settings.id.toLowerCase() === parsed.settings.id.toLowerCase());
    if (clash) { throw new Error(`project id "${parsed.settings.id}" is already used by ${clash.folder}; change id in ${file}`); }
  }
  await registerProjectFolder(libraryRoot, folder, logger);
  await logger.log("INFO", "project", "folder registered as project", { folder, createdProjectFile: existing === undefined });
  return readProject(folder, "external", logger);
}
