/** Writes projects over the read context and the device's folder registry: creating one from a template, adding an existing folder, changing its settings and deleting it from the device. */
import { randomHex } from "../../encoding/index.js";
import { ensureCiteKey, createLibraryLayout } from "../../library/index.js";
import type { PathOps } from "../../path/index.js";
import { deriveTemplatePathProblem, deriveTemplateTreeProblem, type ProjectTemplate, type TemplateFile } from "../../templates/index.js";
import type { ProjectEntry } from "./projectEntry.js";
import {
  PROJECT_FILE, parseProjectFile, serializeProjectFile, updateProjectFile, deriveProjectIdSlug,
  type ProjectFormat, type ProjectSettings, type ProjectSettingsUpdate,
} from "./projectFile.js";
import { listProjects, readOptionalText, readProject, type ProjectReadContext } from "./projectReads.js";

const MODULE = "project";

/** The device-local list of project folders kept outside the library, per library root. */
export interface ProjectFolderRegistry {
  folders(libraryRoot: string): Promise<readonly string[]>;
  register(libraryRoot: string, folder: string): Promise<void>;
  /** Forgets a folder; its files stay where they are. */
  unregister(libraryRoot: string, folder: string): Promise<void>;
}

/** What creating, adding and deleting projects runs over: the read context plus the device's folder registry. */
export interface ProjectCatalogContext extends ProjectReadContext {
  registry: ProjectFolderRegistry;
}

// --- Project ids and paths ---

// INVARIANT: project ids are unique across the library and the registry, because the build cache is keyed by id.
/** Picks a project id from a title that no listed project and no folder under projects/ already uses. */
export async function createProjectId(context: ProjectCatalogContext, libraryRoot: string, title: string): Promise<string> {
  const { fs, paths, registry } = context;
  const entries = await listProjects(context, libraryRoot, await registry.folders(libraryRoot));
  const ids = entries.flatMap((entry) => entry.kind === "ready" ? [entry.settings.id] : []);
  const root = createLibraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot();
  const folderExists = async (id: string) => (await fs.stat(paths.join(root, id))) !== undefined;
  return ensureCiteKey(deriveProjectIdSlug(title), ids, folderExists);
}

/** Tells whether a path is a folder itself, inside it or outside it, with the host's path arithmetic. */
function derivePathRelation(paths: PathOps, folder: string, target: string): "same" | "inside" | "outside" {
  const relative = paths.relative(paths.resolve(folder), paths.resolve(target));
  if (relative === "") { return "same"; }
  return relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative) ? "outside" : "inside";
}

// --- Creating a project from a template ---

/** Throws, naming the path and the reason, when the files are not an installable tree with template.main among them. */
function checkTemplateFiles(template: ProjectTemplate, files: readonly TemplateFile[]): void {
  for (const file of files) {
    const problem = deriveTemplatePathProblem(file.path);
    if (problem !== undefined) { throw new Error(`template ${template.id}: ${problem}`); }
  }
  const treeProblem = deriveTemplateTreeProblem(files.map((file) => ({ path: file.path, size: file.bytes.byteLength })));
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

/** Installs a template as a new library project through a staging folder, so a failure never leaves half a project: stages every file and labshelf.yaml under .research/staging/, then renames the staging folder to projects/<id>/. */
export async function createProjectFromTemplate(
  context: ProjectCatalogContext,
  libraryRoot: string,
  request: { title: string; template: ProjectTemplate; files: readonly TemplateFile[] },
): Promise<ProjectEntry> {
  const { fs, paths, logger } = context;
  const { template, files } = request;
  checkTemplateFiles(template, files);
  const id = await createProjectId(context, libraryRoot, request.title);
  const layout = createLibraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments));
  const staging = paths.join(layout.researchRoot(), "staging", `${id}-${randomHex()}`);
  const folder = paths.join(layout.projectsRoot(), id);
  let step = `staging ${staging}`;
  try {
    for (const file of files) {
      step = `writing ${file.path}`;
      await fs.writeFile(paths.join(staging, ...file.path.split("/")), file.bytes);
    }
    step = `writing ${PROJECT_FILE}`;
    await fs.writeText(paths.join(staging, PROJECT_FILE), serializeProjectFile(projectSettings(id, template)));
    step = `moving into ${folder}`;
    // A folder that appeared since the id was claimed is never reused or merged into, whatever the store's rename does.
    if ((await fs.stat(folder)) !== undefined) { throw new Error(`${folder} already exists`); }
    await fs.mkdir(layout.projectsRoot());
    await fs.rename(staging, folder);
  } catch (error) {
    await fs.removeTree(staging).catch((cleanup: unknown) => logger.error("project", cleanup, { staging, action: "remove staging" }));
    await logger.error("project", error, { templateId: template.id, staging, folder, step });
    throw new Error(`creating project from template ${template.id} failed while ${step}`, { cause: error });
  }
  await logger.log("INFO", "project", "project created", { folder, format: template.format, templateId: template.id });
  return readProject(context, folder, "library");
}

// --- Adding an existing folder ---

async function checkIdIsFree(context: ProjectCatalogContext, libraryRoot: string, folder: string, file: string, id: string): Promise<void> {
  const entries = await listProjects(context, libraryRoot, await context.registry.folders(libraryRoot));
  const clash = entries.find((entry) =>
    entry.kind === "ready" && entry.folder !== folder && entry.settings.id.toLowerCase() === id.toLowerCase());
  if (clash) { throw new Error(`project id "${id}" is already used by ${clash.folder}; change id in ${file}`); }
}

/** Registers a folder outside the library as a project, writing labshelf.yaml only when the folder has none. Never touches anything in the folder but labshelf.yaml (its git repository included). */
export async function addExistingFolder(
  context: ProjectCatalogContext, libraryRoot: string, request: { folder: string; format: ProjectFormat },
): Promise<ProjectEntry> {
  const { fs, paths, logger, registry } = context;
  const folder = paths.resolve(request.folder);
  if (derivePathRelation(paths, libraryRoot, folder) !== "outside") {
    throw new Error(`${folder} is inside the library; create the project with New project instead`);
  }
  const file = paths.join(folder, PROJECT_FILE);
  const existing = await readOptionalText(fs, file);
  if (existing === undefined) {
    const id = await createProjectId(context, libraryRoot, paths.basename(folder));
    await fs.writeText(file, serializeProjectFile({ id, format: request.format }));
  } else {
    const parsed = parseProjectFile(existing);
    if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
    await checkIdIsFree(context, libraryRoot, folder, file, parsed.settings.id);
  }
  await registry.register(libraryRoot, folder);
  await logger.log("INFO", "project", "folder registered as project", { folder, createdProjectFile: existing === undefined });
  return readProject(context, folder, "external");
}

// --- Changing settings and deleting ---

/** Rewrites the settings of a project's labshelf.yaml in place, keeping every field and comment it does not patch; a labshelf.yaml that does not parse is left untouched and the call fails. */
export async function updateProjectSettings(
  { fs, paths, logger }: ProjectReadContext, folder: string, patch: ProjectSettingsUpdate,
): Promise<void> {
  const file = paths.join(folder, PROJECT_FILE);
  const text = await fs.readText(file);
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
  await fs.writeText(file, updateProjectFile(text, patch));
  await logger.log("INFO", "project", "project settings updated", { folder, keys: Object.keys(patch) });
}

/** Deletes a project from the device: a library project's folder is removed, any other folder is only forgotten. Never removes files outside `<library>/projects/`: a registered folder belongs to the user. */
export async function removeProjectFolderForever(context: ProjectCatalogContext, libraryRoot: string, folder: string): Promise<void> {
  const { fs, paths, logger, registry } = context;
  const root = paths.resolve(createLibraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot());
  const target = paths.resolve(folder);
  const relation = derivePathRelation(paths, root, target);
  if (relation === "same") { throw new Error(`refusing to delete ${target}: it is the projects folder of the library`); }
  if (relation === "outside") {
    await registry.unregister(libraryRoot, target);
    await logger.log("INFO", MODULE, "project deleted forever", { folder: target, branch: "unregistered, files kept" });
    return;
  }
  try {
    await fs.removeTree(target);
  } catch (error) {
    await logger.error(MODULE, error, { folder: target, action: "delete forever" });
    throw new Error(`deleting ${target} failed`, { cause: error });
  }
  await logger.log("INFO", MODULE, "project deleted forever", { folder: target, branch: "folder removed" });
}
