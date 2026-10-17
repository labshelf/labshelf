// Tells whether a folder is a LabShelf library and how many papers it holds.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { libraryLayout, METADATA_FILE } from "../../layout.js";

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

// A folder with a metadata.yaml is a paper; any other folder is a collection and is searched for papers.
async function countPapers(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name === METADATA_FILE)) { return 1; }
  const counts = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => countPapers(path.join(dir, entry.name))),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

/** @returns what the folder holds; a missing folder is `exists: false`, not an error */
export async function inspectLibraryFolder(root: string): Promise<LibraryFolderInfo> {
  if (!(await isDirectory(root))) { return { exists: false, isLibrary: false, paperCount: 0 }; }
  if (!(await isLibraryFolder(root))) { return { exists: true, isLibrary: false, paperCount: 0 }; }
  const papersRoot = libraryLayout(root, path.join).papersRoot();
  const entries = await fs.readdir(papersRoot, { withFileTypes: true }).catch(() => []);
  const counts = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => countPapers(path.join(papersRoot, entry.name))),
  );
  return { exists: true, isLibrary: true, paperCount: counts.reduce((sum, count) => sum + count, 0) };
}
