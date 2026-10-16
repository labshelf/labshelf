// Reads a file's bytes, or returns undefined when it does not exist.
import * as fs from "node:fs";

export async function readOptionalFile(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.promises.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}
