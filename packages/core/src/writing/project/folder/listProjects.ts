// Lists the writing projects of a library (its own projects/ folders, then registered folders) and finds one by id.
import { PROJECT_FILE, parseProjectFile } from "../projectFile.js";
import type { ProjectEntry } from "../projectEntry.js";
import { libraryLayout } from "../../../library/index.js";
import { readProject } from "./projectFolder.js";
import type { ProjectReadContext } from "./projectReadContext.js";
import { readOptionalText } from "./readOptionalText.js";

/** Visible folders inside projects/; a missing projects folder lists as empty. */
async function libraryProjectFolders({ fs, paths }: ProjectReadContext, libraryRoot: string): Promise<string[]> {
  const root = libraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot();
  const folders = (await fs.listDir(root)).filter((name) => !name.startsWith(".")).map((name) => paths.join(root, name));
  const stats = await Promise.all(folders.map((folder) => fs.stat(folder)));
  return folders.filter((_, index) => stats[index]?.isDirectory === true);
}

/** The library's own projects, then the registered folders in the order they were added. */
export async function listProjects(
  context: ProjectReadContext, libraryRoot: string, registeredFolders: readonly string[],
): Promise<ProjectEntry[]> {
  const own = await Promise.all((await libraryProjectFolders(context, libraryRoot)).map((folder) => readProject(context, folder, "library")));
  const external = await Promise.all(registeredFolders.map((folder) => readProject(context, folder, "external")));
  return [...own, ...external];
}

/** Reads only each labshelf.yaml; a file system failure is thrown, a missing or unparseable yaml never matches. */
export async function findLibraryProjectFolder(context: ProjectReadContext, libraryRoot: string, id: string): Promise<string | undefined> {
  for (const folder of await libraryProjectFolders(context, libraryRoot)) {
    const text = await readOptionalText(context.fs, context.paths.join(folder, PROJECT_FILE));
    const parsed = text === undefined ? undefined : parseProjectFile(text);
    if (parsed?.ok && parsed.settings.id === id) { return folder; }
  }
  return undefined;
}
