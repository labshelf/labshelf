// Lists the regular files of a project folder as relative POSIX paths.
import { promises as fs } from "node:fs";
import { MAX_PROJECT_FILES } from "../../helperMessages.js";
import { HelperProjectError } from "./helperProjectError.js";

const SKIPPED_FOLDERS = new Set([".git", ".labshelf"]);

// INVARIANT: symlinks are skipped, so a listed path never leads outside the project.
/** @throws limit past the file cap; io when the folder cannot be read */
export async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) {
        await walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        files.push(`${prefix}${entry.name}`);
        if (files.length > MAX_PROJECT_FILES) {
          throw new HelperProjectError("limit", `A project holds at most ${MAX_PROJECT_FILES} files`);
        }
      }
    }
  }
  try {
    await walk(root, "");
  } catch (error) {
    if (error instanceof HelperProjectError) { throw error; }
    throw new HelperProjectError("io", `Could not read project folder "${root}"`, { cause: error });
  }
  return files;
}
