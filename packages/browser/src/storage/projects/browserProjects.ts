// Lists the library's writing projects and reads and writes their files through the library folder file system.
import {
  findLibraryProjectFolder, listProjects, posixPathOps, relativePathProblem,
  type ILogger, type LibraryFileSystem, type ProjectEntry,
} from "@labshelf/core";

const MODULE = "browser.storage.projects";

export interface BrowserProjects {
  listBrowserProjects(): Promise<ProjectEntry[]>;
  readProjectFile(id: string, path: string): Promise<Uint8Array>;
  writeProjectFile(id: string, path: string, bytes: Uint8Array): Promise<void>;
}

interface BrowserProjectsDeps {
  /** INVARIANT: the folder through the bridge only; project files never go to browser storage. */
  fileSystem: LibraryFileSystem;
  logger: ILogger;
}

export function createBrowserProjects({ fileSystem, logger }: BrowserProjectsDeps): BrowserProjects {
  // The bridge root is the library folder itself, so the library root path is empty.
  const reads = { fs: fileSystem, paths: posixPathOps, logger };
  const onFile = async <T>(id: string, path: string, action: "read" | "write", run: (target: string) => Promise<T>): Promise<T> => {
    // TRAP: the path comes from a page, so anything that could climb out of the project or name another root is refused.
    const problem = relativePathProblem(path);
    if (problem !== undefined) throw new Error(`Refused project file path ${JSON.stringify(path)}: it ${problem}`);
    try {
      const folder = await findLibraryProjectFolder(reads, "", id);
      if (folder === undefined) throw new Error(`No library project has the id ${JSON.stringify(id)}`);
      return await run(`${folder}/${path}`);
    } catch (error) {
      await logger.error(MODULE, error, { project: id, path, action });
      throw error;
    }
  };

  return {
    listBrowserProjects: () => listProjects(reads, "", []),
    readProjectFile: (id, path) => onFile(id, path, "read", (target) => fileSystem.readFile(target)),
    writeProjectFile: (id, path, bytes) => onFile(id, path, "write", (target) => fileSystem.writeFile(target, bytes)),
  };
}
