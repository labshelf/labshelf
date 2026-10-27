// Runs the mirror's disk over the library file-system port, for hosts without a native file watcher.
import { sleep } from "../../../async/index.js";
import { sameBytes } from "../../../encoding/index.js";
import { posixPathOps } from "../../../path/index.js";
import type { LibraryFileSystem, LocalStat } from "../../../ports/index.js";
import { assertProjectDirReadable, listMirrorFiles } from "./listMirrorFiles.js";
import type { MirrorFileRead, MirrorFileSystem } from "./mirrorFileSystem.js";

interface Sample { stat: LocalStat; bytes: Uint8Array }

const same = (a: Sample | undefined, b: Sample | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.stat.size === b.stat.size && a.stat.mtimeMs === b.stat.mtimeMs && sameBytes(a.bytes, b.bytes);

/** The disk of a project folder at `folder`, a "/"-separated path of the port. */
export function createLibraryMirrorFileSystem(fs: LibraryFileSystem, folder: string): MirrorFileSystem {
  const reads = { fs, paths: posixPathOps };
  const full = (relative: string) => posixPathOps.join(folder, ...relative.split("/"));

  async function sample(relative: string): Promise<Sample | undefined> {
    try {
      const stat = await fs.stat(full(relative));
      if (stat?.isFile === true) { return { stat, bytes: await fs.readFile(full(relative)) }; }
    } catch (error) {
      await assertProjectDirReadable(reads, folder);
      throw error;
    }
    await assertProjectDirReadable(reads, folder);
    return undefined;
  }

  return {
    async read(relative: string, stableMs?: number): Promise<MirrorFileRead> {
      const first = await sample(relative);
      if (stableMs !== undefined) {
        await sleep(stableMs);
        if (!same(first, await sample(relative))) { return { state: "changing" }; }
      }
      return first ? { state: "present", bytes: first.bytes } : { state: "missing" };
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
