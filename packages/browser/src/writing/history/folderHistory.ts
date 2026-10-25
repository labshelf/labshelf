// Builds the history target of a library-folder project: its files are read from the folder, its entries kept in IndexedDB.
import { posixPathOps, type HistoryProject, type LibraryFileSystem } from "@labshelf/core";
import { createIdbHistoryStorage } from "../../storage";

export function createHistoryProject(fs: LibraryFileSystem, folder: string, projectId: string): HistoryProject {
  return { project: { fs, paths: posixPathOps }, folder, storage: createIdbHistoryStorage(projectId) };
}
