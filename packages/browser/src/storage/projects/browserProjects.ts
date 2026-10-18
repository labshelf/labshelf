// Lists the library's writing projects and reads, writes, lists and stats their files through the library folder file system.
import {
  findLibraryProjectFolder, listProjects, posixPathOps, relativePathProblem,
  type ILogger, type LibraryFileSystem, type LocalStat, type ProjectEntry,
} from "@labshelf/core";

import { listFolderEntries, type FolderEntry } from "./folderEntries";

const MODULE = "browser.storage.projects";

/** A read of a path with no file (missing, or a folder): an expected answer (the editor probes for settings files), not a failure. */
export class ProjectFileNotFoundError extends Error {
  constructor(readonly projectId: string, readonly path: string) {
    super(`${path} does not exist in project ${projectId}`);
    this.name = "ProjectFileNotFoundError";
  }
}

export interface BrowserProjects {
  listBrowserProjects(): Promise<ProjectEntry[]>;
  readProjectFile(id: string, path: string): Promise<Uint8Array>;
  writeProjectFile(id: string, path: string, bytes: Uint8Array): Promise<void>;
  /** The entries of a folder inside the project, `""` naming the project folder; a missing folder has none. */
  listProjectDirectory(id: string, path: string): Promise<FolderEntry[]>;
  /** Undefined when the path does not exist; `""` names the project folder. */
  statProjectPath(id: string, path: string): Promise<LocalStat | undefined>;
}

interface BrowserProjectsDeps {
  /** INVARIANT: the folder through the bridge only; project files never go to browser storage. */
  fileSystem: LibraryFileSystem;
  logger: ILogger;
}

type Action = "read" | "write" | "list" | "stat";

export function createBrowserProjects({ fileSystem, logger }: BrowserProjectsDeps): BrowserProjects {
  // The bridge root is the library folder itself, so the library root path is empty.
  const reads = { fs: fileSystem, paths: posixPathOps, logger };
  const onPath = async <T>(id: string, path: string, action: Action, run: (target: string) => Promise<T>): Promise<T> => {
    // TRAP: the path comes from a page, so anything that could climb out of the project or name another root is refused.
    const folderItself = path === "" && (action === "list" || action === "stat");
    const problem = folderItself ? undefined : relativePathProblem(path);
    if (problem !== undefined) throw new Error(`Refused project file path ${JSON.stringify(path)}: it ${problem}`);
    let target: string | undefined;
    try {
      const folder = await findLibraryProjectFolder(reads, "", id);
      if (folder === undefined) throw new Error(`No library project has the id ${JSON.stringify(id)}`);
      target = folderItself ? folder : `${folder}/${path}`;
      return await run(target);
    } catch (error) {
      if (action === "read" && target !== undefined && await noFileAt(target)) throw new ProjectFileNotFoundError(id, path);
      await logger.error(MODULE, error, { project: id, path, action });
      throw error;
    }
  };
  // The file systems name a missing file differently, so a failed read asks whether a file is there at all (a folder is not one).
  const noFileAt = (target: string): Promise<boolean> => fileSystem.stat(target).then((found) => found === undefined || found.isDirectory, () => false);

  return {
    listBrowserProjects: () => listProjects(reads, "", []),
    readProjectFile: (id, path) => onPath(id, path, "read", (target) => fileSystem.readFile(target)),
    writeProjectFile: (id, path, bytes) => onPath(id, path, "write", (target) => fileSystem.writeFile(target, bytes)),
    listProjectDirectory: (id, path) => onPath(id, path, "list", (target) => listFolderEntries(fileSystem, target)),
    statProjectPath: (id, path) => onPath(id, path, "stat", (target) => fileSystem.stat(target)),
  };
}
