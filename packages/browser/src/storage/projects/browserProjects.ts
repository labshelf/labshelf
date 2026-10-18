// Gives the editor and the writing tab the library's writing projects and their files through the library folder file system.
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
  /** Moves a file or folder inside the project; an existing file at `to` is replaced, written whole before `from` goes. */
  renameProjectPath(id: string, from: string, to: string): Promise<void>;
  /** Deletes a file or a folder with everything in it. */
  deleteProjectPath(id: string, path: string): Promise<void>;
  createProjectDirectory(id: string, path: string): Promise<void>;
}

interface BrowserProjectsDeps {
  /** INVARIANT: the folder through the bridge only; project files never go to browser storage. */
  fileSystem: LibraryFileSystem;
  logger: ILogger;
}

type Action = "read" | "write" | "list" | "stat" | "rename" | "delete" | "mkdir";

const isCaseOnly = (from: string, to: string): boolean => from !== to && from.toLowerCase() === to.toLowerCase();

export function createBrowserProjects({ fileSystem, logger }: BrowserProjectsDeps): BrowserProjects {
  // The bridge root is the library folder itself, so the library root path is empty.
  const reads = { fs: fileSystem, paths: posixPathOps, logger };
  const onPath = async <T>(id: string, path: string, action: Action, run: (target: string, folder: string) => Promise<T>): Promise<T> => {
    const folderItself = path === "" && (action === "list" || action === "stat");
    if (!folderItself) refuseEscape(path);
    let target: string | undefined;
    try {
      const folder = await findLibraryProjectFolder(reads, "", id);
      if (folder === undefined) throw new Error(`No library project has the id ${JSON.stringify(id)}`);
      target = folderItself ? folder : `${folder}/${path}`;
      return await run(target, folder);
    } catch (error) {
      if (action === "read" && target !== undefined && await noFileAt(target)) throw new ProjectFileNotFoundError(id, path);
      await logger.error(MODULE, error, { project: id, path, action });
      throw error;
    }
  };
  // The file systems name a missing file differently, so a failed read asks whether a file is there at all (a folder is not one).
  // TRAP: the path comes from a page, so anything that could climb out of the project or name another root is refused.
  const refuseEscape = (path: string): void => {
    const problem = relativePathProblem(path);
    if (problem !== undefined) throw new Error(`Refused project file path ${JSON.stringify(path)}: it ${problem}`);
  };
  /** The port refuses an existing target, so a file is replaced by writing it whole, which the host does atomically. */
  const moveOrReplace = async (source: string, target: string): Promise<void> => {
    // TRAP: on a case-insensitive disk the case-only target stats as the source itself; copying onto it would lose the file.
    const existing = isCaseOnly(source, target) ? undefined : await fileSystem.stat(target);
    if (!existing?.isFile) return fileSystem.rename(source, target);
    await fileSystem.writeFile(target, await fileSystem.readFile(source));
    await fileSystem.deleteFile(source);
  };
  const noFileAt = (target: string): Promise<boolean> => fileSystem.stat(target).then((found) => found === undefined || found.isDirectory, () => false);

  return {
    listBrowserProjects: () => listProjects(reads, "", []),
    readProjectFile: (id, path) => onPath(id, path, "read", (target) => fileSystem.readFile(target)),
    writeProjectFile: (id, path, bytes) => onPath(id, path, "write", (target) => fileSystem.writeFile(target, bytes)),
    listProjectDirectory: (id, path) => onPath(id, path, "list", (target) => listFolderEntries(fileSystem, target)),
    statProjectPath: (id, path) => onPath(id, path, "stat", (target) => fileSystem.stat(target)),
    renameProjectPath: async (id, from, to) => {
      refuseEscape(to);
      return onPath(id, from, "rename", (source, folder) => moveOrReplace(source, `${folder}/${to}`));
    },
    deleteProjectPath: (id, path) => onPath(id, path, "delete", (target) => fileSystem.removeTree(target)),
    createProjectDirectory: (id, path) => onPath(id, path, "mkdir", (target) => fileSystem.mkdir(target)),
  };
}
