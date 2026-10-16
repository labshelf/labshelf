/** Lists, creates and registers the writing projects of a library: its own projects/ folders and registered folders. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { claimCiteKey, joinWith, libraryLayout } from "../../../library/index.js";
import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { PROJECT_FILE, parseProjectFile, serializeProjectFile, type ProjectFormat, type ProjectSettings } from "../projectFile.js";
import type { ProjectEntry } from "../projectEntry.js";
import { projectIdSlug } from "../projectId.js";
import { templatePathProblem, templateTreeProblem } from "../../templates/index.js";
import type { ProjectTemplate, TemplateFile } from "../../templates/index.js";
import { readProject } from "./projectFolder.js";
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

/** Throws, naming the path and the reason, when the files are not an installable tree with template.main among them. */
function checkTemplateFiles(template: ProjectTemplate, files: readonly TemplateFile[]): void {
  for (const file of files) {
    const problem = templatePathProblem(file.path);
    if (problem !== undefined) { throw new Error(`template ${template.id}: ${problem}`); }
  }
  const treeProblem = templateTreeProblem(files.map((file) => ({ path: file.path, size: file.bytes.byteLength })));
  if (treeProblem !== undefined) { throw new Error(`template ${template.id}: ${treeProblem}`); }
  if (!files.some((file) => file.path === template.main)) {
    throw new Error(`template ${template.id}: main file "${template.main}" is not among its files`);
  }
}

function projectSettings(id: string, template: ProjectTemplate): ProjectSettings {
  const { format, main, engine } = template;
  // A typst template's engine is "typst", which labshelf.yaml never stores.
  return format === "latex" && engine !== undefined && engine !== "typst" ? { id, format, main, engine } : { id, format, main };
}

/**
 * Installs a template as <library>/projects/<id>/: stages every file and labshelf.yaml under .research/staging/<id>/,
 * then renames the staging folder into place, so a failure never leaves a half-written project.
 */
export async function createProjectFromTemplate(
  libraryRoot: string,
  request: { title: string; template: ProjectTemplate; files: readonly TemplateFile[] },
  logger: ILogger,
): Promise<ProjectEntry> {
  const { template, files } = request;
  checkTemplateFiles(template, files);
  const id = await claimProjectId(libraryRoot, request.title, logger);
  const layout = libraryLayout(libraryRoot, joinWith(path.sep as "/" | "\\"));
  const staging = path.join(layout.researchRoot(), "staging", id);
  const folder = path.join(layout.projectsRoot(), id);
  let step = `staging ${staging}`;
  try {
    await fs.rm(staging, { recursive: true, force: true });
    for (const file of files) {
      step = `writing ${file.path}`;
      await writeFileAtomic(path.join(staging, ...file.path.split("/")), file.bytes);
    }
    step = `writing ${PROJECT_FILE}`;
    await writeFileAtomic(path.join(staging, PROJECT_FILE), serializeProjectFile(projectSettings(id, template)));
    step = `moving into ${folder}`;
    // A folder that appeared since the id was claimed is never reused or merged into.
    if (await fs.stat(folder).then(() => true, () => false)) { throw new Error(`${folder} already exists`); }
    await fs.mkdir(layout.projectsRoot(), { recursive: true });
    await fs.rename(staging, folder);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    await logger.error("project", error, { templateId: template.id, staging, folder, step });
    throw new Error(`creating project from template ${template.id} failed while ${step}`, { cause: error });
  }
  await logger.log("INFO", "project", "project created", { folder, format: template.format, templateId: template.id });
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
  const existing = await readOptionalFile(file);
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
