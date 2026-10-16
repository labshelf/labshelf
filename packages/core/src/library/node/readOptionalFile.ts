// Reads a UTF-8 file and returns undefined when it does not exist.
import { promises as fs } from "node:fs";

export async function readOptionalFile(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}
