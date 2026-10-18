// Builds the history target of a library-folder project: its files are read from the folder, its entries kept in IndexedDB.
import { posixPathOps, type HistoryTarget, type LibraryFileSystem } from "@labshelf/core";
import { idbHistoryStorage } from "../../../storage";

export function projectHistoryTarget(fs: LibraryFileSystem, folder: string, projectId: string): HistoryTarget {
  return { project: { fs, paths: posixPathOps }, folder, storage: idbHistoryStorage(projectId) };
}
