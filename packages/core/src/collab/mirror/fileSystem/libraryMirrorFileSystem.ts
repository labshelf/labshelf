// Runs the mirror's disk over the library file-system port, for hosts without a native file watcher.
import { posixPathOps } from "../../../path/index.js";
import type { LibraryFileSystem } from "../../../ports/index.js";
import { assertProjectDirReadable, listMirrorFiles } from "./listMirrorFiles.js";
import type { MirrorFileRead, MirrorFileSystem } from "./mirrorFileSystem.js";
import { readStable, type MirrorSample } from "./readStable.js";

/** The disk of a project folder at `folder`, a "/"-separated path of the port. */
export function createLibraryMirrorFileSystem(fs: LibraryFileSystem, folder: string): MirrorFileSystem {
  const reads = { fs, paths: posixPathOps };
  const full = (relative: string) => posixPathOps.join(folder, ...relative.split("/"));

  async function sample(relative: string): Promise<MirrorSample | undefined> {
    try {
      const stat = await fs.stat(full(relative));
      if (stat?.isFile === true) { return { size: stat.size, mtimeMs: stat.mtimeMs, bytes: await fs.readFile(full(relative)) }; }
    } catch (error) {
      await assertProjectDirReadable(reads, folder);
      throw error;
    }
    await assertProjectDirReadable(reads, folder);
    return undefined;
  }

  return {
    async read(relative: string, stableMs?: number): Promise<MirrorFileRead> {
      return readStable(() => sample(relative), stableMs);
    },
    async write(relative: string, bytes: Uint8Array): Promise<void> {
      // ensureDir would bring a deleted project folder back with a single file in it.
      await assertProjectDirReadable(reads, folder);
      await fs.ensureDir(posixPathOps.dirname(full(relative)));
      await fs.writeFile(full(relative), bytes);
    },
    async remove(relative: string): Promise<void> {
      if ((await fs.stat(full(relative)))?.isFile === true) { await fs.deleteFile(full(relative)); }
    },
    list: () => listMirrorFiles(reads, folder),
  };
}
