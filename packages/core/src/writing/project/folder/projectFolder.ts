// Reads one project folder into a project entry and lists the file names at its root.
import { readProjectEntry, type ProjectFolderReader } from "../readProjectEntry.js";
import type { ProjectEntry, ProjectPlacement } from "../projectEntry.js";
import { readOptionalText } from "./readOptionalText.js";
import type { ProjectReadContext } from "./projectReadContext.js";

/** Names of the files at the folder's root; sources in subfolders are not main candidates. */
export async function listBuildRootFileNames({ fs, paths }: Pick<ProjectReadContext, "fs" | "paths">, folder: string): Promise<string[]> {
  const names = await fs.listDir(folder);
  const stats = await Promise.all(names.map((name) => fs.stat(paths.join(folder, name))));
  return names.filter((_, index) => stats[index]?.isFile === true);
}

/** Reads the folder through the port; see readProjectEntry for how a project that cannot be read is returned. */
export function readProject(context: ProjectReadContext, folder: string, location: ProjectPlacement): Promise<ProjectEntry> {
  const { fs, paths, logger } = context;
  const reader: ProjectFolderReader = {
    readOptionalText: (name) => readOptionalText(fs, paths.join(folder, name)),
    rootFileNames: () => listBuildRootFileNames(context, folder),
    exists: async () => (await fs.stat(folder))?.isDirectory === true,
  };
  return readProjectEntry({ folder, location, reader, logger });
}
