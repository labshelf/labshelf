// Reads a text file through the file-system port, treating anything that is not a file as absent.
import type { LibraryFileSystem } from "../../../ports/index.js";

export async function readOptionalText(fs: LibraryFileSystem, file: string): Promise<string | undefined> {
  return (await fs.stat(file))?.isFile ? fs.readText(file) : undefined;
}
