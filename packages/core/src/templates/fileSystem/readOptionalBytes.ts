// Reads a file's bytes through the library file-system port, or returns undefined when it is not a file.
import type { LibraryFileSystem } from "../../ports/index.js";

export async function readOptionalBytes(fs: LibraryFileSystem, file: string): Promise<Uint8Array | undefined> {
  const stat = await fs.stat(file);
  return stat?.isFile === true ? fs.readFile(file) : undefined;
}
