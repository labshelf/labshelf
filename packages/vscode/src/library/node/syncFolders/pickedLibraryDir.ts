// Decides where a library lives when the user picks a folder: the folder itself, or a LabShelf folder inside it.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { detectLibraryFolder } from "@labshelf/core/node";

export const LIBRARY_FOLDER_NAME = "LabShelf";

/** @returns the picked folder when it is a library or empty, otherwise `<picked>/LabShelf`, so a library never mixes with other files */
export async function libraryTargetFolder(picked: string): Promise<string> {
  const info = await detectLibraryFolder(picked);
  if (!info.exists || info.isLibrary) { return picked; }
  const entries = await fs.readdir(picked);
  return entries.length === 0 ? picked : path.join(picked, LIBRARY_FOLDER_NAME);
}
