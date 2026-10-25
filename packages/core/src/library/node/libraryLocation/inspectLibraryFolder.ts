// Tells whether a folder is a LabShelf library and how many papers it holds.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { libraryLayout } from "../../layout.js";
import { countPaperFolders } from "./countPaperFolders.js";

export interface LibraryFolderInfo {
  exists: boolean;
  isLibrary: boolean;
  paperCount: number;
}

async function isDirectory(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isDirectory(), () => false);
}

/** @returns true when every marker folder of the library layout exists in `root` */
export async function isLibraryFolder(root: string): Promise<boolean> {
  const checks = await Promise.all(libraryLayout(root, path.join).markerDirs().map(isDirectory));
  return checks.every(Boolean);
}

/** @returns what the folder holds; a missing folder is `exists: false`, not an error */
export async function inspectLibraryFolder(root: string): Promise<LibraryFolderInfo> {
  if (!(await isDirectory(root))) { return { exists: false, isLibrary: false, paperCount: 0 }; }
  if (!(await isLibraryFolder(root))) { return { exists: true, isLibrary: false, paperCount: 0 }; }
  const papersRoot = libraryLayout(root, path.join).papersRoot();
  return { exists: true, isLibrary: true, paperCount: await countPaperFolders(papersRoot) };
}
