// Installs a template as a new library project through a staging folder, so a failure never leaves half a project.
import { createLibraryLayout } from "../../../library/index.js";
import { deriveTemplatePathProblem, deriveTemplateTreeProblem, type ProjectTemplate, type TemplateFile } from "../../../templates/index.js";
import { readProject } from "../folder/index.js";
import type { ProjectEntry } from "../projectEntry.js";
import { PROJECT_FILE, serializeProjectFile, type ProjectSettings } from "../projectFile.js";
import { createProjectId } from "./createProjectId.js";
import type { ProjectCatalogContext } from "./projectCatalogContext.js";

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

function randomSuffix(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stages every file and labshelf.yaml under .research/staging/, then renames the staging folder to projects/<id>/. */
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
  const staging = paths.join(layout.researchRoot(), "staging", `${id}-${randomSuffix()}`);
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
