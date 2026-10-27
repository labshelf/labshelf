/** Saves templates into <library>/templates/<template id>/: a writing project of the library, or an exact submission with its compiled previews. */
// CONTRACT: documents/contracts/templates.md#my-templates

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ensureCiteKey, joinWith, createLibraryLayout } from "../../library/index.js";
import { writeFileAtomic } from "../../library/node/index.js";
import { resolveInLibrary } from "../../bridge/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { PROJECT_FILE, deriveProjectIdSlug, type LatexEngine, type ProjectEntry } from "../../writing/project/index.js";
import { listLibraryProjects } from "../../writing/project/node/index.js";
import type { PublishFile } from "../templateLabels.js";
import {
  parseTemplateManifest, serializeTemplateManifest, deriveTemplateTreeProblem, deriveTemplatePathProblem,
  type TemplateKind, type TemplateManifest,
} from "../templateManifest/index.js";
import { listProjectFiles, type FoundFile } from "./templateFolder.js";


const MODULE = "templates";
const MANIFEST_FILE = "template.yaml";
// Leaves room for the suffix that makes the id unique within the 64-character limit.
const MAX_ID_BASE = 60;

/** What the user fills in when saving; `engine` is the one the app resolved for the build, used when labshelf.yaml names none. */
export interface WriteTemplateInput {
  name: string;
  category: TemplateKind;
  license: string;
  description: string;
  authors: string[];
  engine?: LatexEngine;
}

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

async function findProject(libraryRoot: string, projectId: string, logger: ILogger): Promise<ReadyProject> {
  const entry = (await listLibraryProjects(libraryRoot, logger)).find((e) => e.kind === "ready" && e.settings.id === projectId);
  if (entry === undefined || entry.kind !== "ready") { throw new Error(`no project has the id "${projectId}"`); }
  return entry;
}

/** The kept files of the project; a symbolic link or a tree that breaks the path rules throws naming the path. */
async function projectFiles(folder: string): Promise<FoundFile[]> {
  const files = await listProjectFiles(folder);
  const problem = deriveTemplateTreeProblem(files);
  if (problem !== undefined) { throw new Error(problem); }
  return files;
}

function buildManifest(project: ReadyProject, details: WriteTemplateInput, id: string): TemplateManifest {
  const { format, engine: projectEngine } = project.settings;
  const engine = format === "typst" ? "typst" : projectEngine ?? details.engine;
  if (engine === undefined) { throw new Error(`project "${project.settings.id}" has no engine; set engine in its ${PROJECT_FILE}`); }
  if (project.main === undefined) { throw new Error(`project "${project.settings.id}" has no main file`); }
  const { name, description, category, license, authors } = details;
  const manifest: TemplateManifest = { id, name, description, category, format, engine, main: project.main, license, authors };
  // Parsing the written text back is the same check every reader of template.yaml applies.
  const parsed = parseTemplateManifest(serializeTemplateManifest(manifest));
  if (!parsed.ok) { throw new Error(`template manifest ${parsed.reason}`); }
  return parsed.manifest;
}

async function claimTemplateId(templatesRoot: string, name: string): Promise<string> {
  const taken = await fs.readdir(templatesRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return []; }
    throw error;
  });
  const base = deriveProjectIdSlug(name).slice(0, MAX_ID_BASE).replace(/-+$/, "");
  return ensureCiteKey(base, taken, (id) => fs.stat(path.join(templatesRoot, id)).then(() => true, () => false));
}

async function stageTemplate(staging: string, manifest: TemplateManifest, files: readonly FoundFile[]): Promise<void> {
  for (const file of files) {
    await writeFileAtomic(path.join(staging, "files", ...file.path.split("/")), await fs.readFile(file.absolute));
  }
  await writeFileAtomic(path.join(staging, MANIFEST_FILE), serializeTemplateManifest(manifest));
}

/**
 * Copies the project's files and a template.yaml into a staging folder under .research/staging/, then renames it into
 * <library>/templates/<id>/, so a failure never leaves a half-written template.
 */
export async function writeProjectAsTemplate(
  libraryRoot: string,
  projectId: string,
  details: WriteTemplateInput,
  logger: ILogger,
): Promise<TemplateManifest> {
  const layout = createLibraryLayout(libraryRoot, joinWith(path.sep as "/" | "\\"));
  const templatesRoot = path.join(libraryRoot, "templates");
  let staging: string | undefined;
  let folder: string | undefined;
  try {
    const project = await findProject(libraryRoot, projectId, logger);
    const files = await projectFiles(project.folder);
    const manifest = buildManifest(project, details, await claimTemplateId(templatesRoot, details.name));
    const stagingRoot = path.join(layout.researchRoot(), "staging");
    await fs.mkdir(stagingRoot, { recursive: true });
    staging = await fs.mkdtemp(path.join(stagingRoot, "template-"));
    await stageTemplate(staging, manifest, files);
    folder = path.join(templatesRoot, manifest.id);
    // A folder that appeared since the id was claimed is never reused or merged into.
    if (await fs.stat(folder).then(() => true, () => false)) { throw new Error(`${folder} already exists`); }
    await fs.mkdir(templatesRoot, { recursive: true });
    await fs.rename(staging, folder);
    await logger.log("INFO", MODULE, "template saved", { projectId, templateId: manifest.id, folder });
    return manifest;
  } catch (error) {
    if (staging !== undefined) { await fs.rm(staging, { recursive: true, force: true }); }
    await logger.error(MODULE, error, { action: "save project as template", projectId, staging, folder });
    throw new Error(`saving project "${projectId}" as a template failed: ${(error as Error).message}`, { cause: error });
  }
}

/** Saves the exact submitted template with its compiled previews into My templates atomically. */
export async function writePublishedTemplate(libraryRoot: string, manifest: TemplateManifest, files: readonly PublishFile[]): Promise<void> {
  const templates = await resolveInLibrary(libraryRoot, "templates");
  await fs.mkdir(templates, { recursive: true });
  const names = await fs.readdir(templates);
  const id = await ensureCiteKey(manifest.id, names, async (name) => {
    try { await fs.lstat(path.join(templates, name)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  });
  const stagingRoot = await resolveInLibrary(libraryRoot, ".research/staging");
  await fs.mkdir(stagingRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(stagingRoot, "template-"));
  try {
    for (const file of files) {
      const problem = deriveTemplatePathProblem(file.path);
      if (problem) throw new Error(problem);
      const target = path.join(staging, ...file.path.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.path === "template.yaml" ? serializeTemplateManifest({ ...manifest, id }) : file.bytes);
    }
    const destination = await resolveInLibrary(libraryRoot, `templates/${id}`);
    try { await fs.lstat(destination); throw new Error(`Template "${id}" already exists`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.rename(staging, destination);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
