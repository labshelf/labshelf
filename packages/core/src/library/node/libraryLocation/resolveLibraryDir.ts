// Decides which folder a library lives in when the user names a folder that may already hold other files.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { detectLibraryFolder } from "./detectLibraryFolder.js";

export const LIBRARY_FOLDER_NAME = "LabShelf";

/**
 * A missing, empty or library folder is the target itself; a non-empty folder that is not a library gets a
 * `LabShelf` subfolder, so a library never mixes with unrelated files.
 * @param options.unreadableAsEmpty treats a folder that cannot be listed as empty instead of rejecting
 * @returns the absolute target folder
 */
export async function resolveLibraryDir(picked: string, options: { unreadableAsEmpty?: boolean } = {}): Promise<string> {
  const folder = path.resolve(picked);
  const info = await detectLibraryFolder(folder);
  if (!info.exists || info.isLibrary) { return folder; }
  const listing = fs.readdir(folder);
  const entries = options.unreadableAsEmpty ? await listing.catch(() => []) : await listing;
  return entries.length > 0 ? path.join(folder, LIBRARY_FOLDER_NAME) : folder;
}
