// Reads and writes paper sidecars at the library layout's .research/papers/<paperId>/data.json in either library source.
import { joinWith, libraryLayout, type LibraryFileSystem, type SidecarPort } from "@labshelf/core";

const layout = libraryLayout("", joinWith("/"));

/**
 * @returns a SidecarPort reading and writing UTF-8 JSON through the library file system; a missing file reads as null.
 */
export function createSidecarPort(fs: Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile">): SidecarPort {
  return {
    async read(paperId) {
      const path = layout.paperDataPath(paperId);
      if (!(await fs.stat(path))?.isFile) return null;
      return new TextDecoder().decode(await fs.readFile(path));
    },
    async write(paperId, text) {
      await fs.writeFile(layout.paperDataPath(paperId), new TextEncoder().encode(text));
    },
  };
}
