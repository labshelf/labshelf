// Registers a folder outside the library as a project, writing labshelf.yaml only when the folder has none.
import { listProjects, readOptionalText, readProject } from "../folder/index.js";
import type { ProjectEntry } from "../projectEntry.js";
import { PROJECT_FILE, parseProjectFile, serializeProjectFile, type ProjectFormat } from "../projectFile.js";
import { claimProjectId } from "./claimProjectId.js";
import { derivePathRelation } from "./derivePathRelation.js";
import type { ProjectCatalogContext } from "./projectCatalogContext.js";

async function checkIdIsFree(context: ProjectCatalogContext, libraryRoot: string, folder: string, file: string, id: string): Promise<void> {
  const entries = await listProjects(context, libraryRoot, await context.registry.folders(libraryRoot));
  const clash = entries.find((entry) =>
    entry.kind === "ready" && entry.folder !== folder && entry.settings.id.toLowerCase() === id.toLowerCase());
  if (clash) { throw new Error(`project id "${id}" is already used by ${clash.folder}; change id in ${file}`); }
}

/** Never touches anything in the folder but labshelf.yaml (its git repository included). */
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
    const id = await claimProjectId(context, libraryRoot, paths.basename(folder));
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
