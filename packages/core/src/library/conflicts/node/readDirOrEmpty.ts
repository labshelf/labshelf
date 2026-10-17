// Lists a folder's entries, treating a missing folder as empty.
import { promises as fs, type Dirent } from "node:fs";

/** @returns the folder's entries, or none when the folder does not exist. */
export async function readDirOrEmpty(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
    throw error;
  }
}
