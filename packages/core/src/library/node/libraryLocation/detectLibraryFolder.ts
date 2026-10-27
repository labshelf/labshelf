// Tells whether a folder is a LabShelf library and how many papers it holds.
import * as path from "node:path";

import { isDirectory } from "../../../files/node/index.js";
import { createLibraryLayout } from "../../layout.js";
import { countPaperFolders } from "./countPaperFolders.js";

export interface LibraryFolderDetails {
  exists: boolean;
  isLibrary: boolean;
  paperCount: number;
}

/** @returns true when every marker folder of the library layout exists in `root` */
export async function isLibraryFolder(root: string): Promise<boolean> {
  const checks = await Promise.all(createLibraryLayout(root, path.join).markerDirs().map(isDirectory));
  return checks.every(Boolean);
}

/** @returns what the folder holds; a missing folder is `exists: false`, not an error */
export async function detectLibraryFolder(root: string): Promise<LibraryFolderDetails> {
  if (!(await isDirectory(root))) { return { exists: false, isLibrary: false, paperCount: 0 }; }
  if (!(await isLibraryFolder(root))) { return { exists: true, isLibrary: false, paperCount: 0 }; }
  const papersRoot = createLibraryLayout(root, path.join).papersRoot();
  return { exists: true, isLibrary: true, paperCount: await countPaperFolders(papersRoot) };
}
