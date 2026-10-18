// Serves the library files outside projects/ (papers, bibliography, LabShelf's own files) to the workbench, over the library file system.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import {
  createFileSystemProviderError, FileSystemProviderErrorCode, FileType, type IStat,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { listFolderEntries, moveOrReplace } from "../../storage/projects";

const MODULE = "browser.editor.libraryFiles";

const notFound = (path: string) => createFileSystemProviderError(`${path} does not exist`, FileSystemProviderErrorCode.FileNotFound);

/** File operations on library-relative paths (`""` is the library folder), failing the way the workbench expects. */
export function createLibraryFiles(fileSystem: LibraryFileSystem, logger: ILogger) {
  // The workbench probes for files that may not exist; only a failure on a file that exists is logged.
  const call = async <T>(path: string, action: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (await fileSystem.stat(path).then((found) => found === undefined, () => false)) throw notFound(path);
      await logger.error(MODULE, error, { path, action });
      throw createFileSystemProviderError(`Could not ${action} ${path}: ${error instanceof Error ? error.message : String(error)}`, FileSystemProviderErrorCode.Unavailable);
    }
  };

  return {
    async stat(path: string): Promise<IStat> {
      if (path === "") return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      const found = await call(path, "stat", () => fileSystem.stat(path));
      if (found === undefined) throw notFound(path);
      return { type: found.isDirectory ? FileType.Directory : FileType.File, ctime: found.mtimeMs, mtime: found.mtimeMs, size: found.size };
    },
    async readdir(path: string): Promise<[string, FileType][]> {
      const entries = await call(path, "list", () => listFolderEntries(fileSystem, path));
      return entries.map(({ name, kind }): [string, FileType] => [name, kind === "directory" ? FileType.Directory : FileType.File]);
    },
    readFile: (path: string) => call(path, "read", () => fileSystem.readFile(path)),
    async writeFile(path: string, content: Uint8Array, opts: { create: boolean; overwrite: boolean }): Promise<void> {
      const exists = await fileSystem.exists(path);
      if (!exists && !opts.create) throw notFound(path);
      if (exists && !opts.overwrite) throw createFileSystemProviderError(`${path} already exists`, FileSystemProviderErrorCode.FileExists);
      await call(path, "write", () => fileSystem.writeFile(path, content));
    },
    mkdir: (path: string) => call(path, "create", () => fileSystem.mkdir(path)),
    delete: (path: string) => call(path, "delete", () => fileSystem.removeTree(path)),
    async rename(from: string, to: string, opts: { overwrite: boolean }): Promise<void> {
      if (!opts.overwrite && await fileSystem.exists(to)) throw createFileSystemProviderError(`${to} already exists`, FileSystemProviderErrorCode.FileExists);
      await call(from, "rename", () => moveOrReplace(fileSystem, from, to));
    },
  };
}
