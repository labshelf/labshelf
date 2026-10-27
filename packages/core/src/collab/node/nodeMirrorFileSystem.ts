// Runs the mirror's disk over a project folder through Node: settled reads, atomic writes and a recursive watch.
import { promises as fs, watch } from "node:fs";
import * as path from "node:path";
import { sleep } from "../../async/index.js";
import { writeFileAtomic } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { nodeFileReads } from "../../writing/project/node/index.js";
import { assertProjectDirReadable, listMirrorFiles, MirrorProjectDirUnavailable, type MirrorFileSystem } from "../mirror/fileSystem/index.js";
import type { MirrorFileRead } from "../mirror/index.js";

interface Sample { size: number; mtimeMs: number; bytes: Uint8Array }

async function sample(file: string): Promise<Sample | undefined> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) { return undefined; }
    return { size: stat.size, mtimeMs: stat.mtimeMs, bytes: new Uint8Array(await fs.readFile(file)) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") { return undefined; }
    throw error;
  }
}

const same = (a: Sample | undefined, b: Sample | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.size === b.size && a.mtimeMs === b.mtimeMs && Buffer.from(a.bytes).equals(Buffer.from(b.bytes));

/** One read when `settleMs` is undefined; otherwise `changing` unless size, mtime and bytes agree `settleMs` later. */
async function readDisk(file: string, settleMs?: number): Promise<MirrorFileRead> {
  const first = await sample(file);
  if (settleMs !== undefined) {
    await sleep(settleMs);
    if (!same(first, await sample(file))) { return { state: "changing" }; }
  }
  return first ? { state: "present", bytes: first.bytes } : { state: "missing" };
}

const LOG_MODULE = "collab.mirror";

/** Starts watching; the returned function stops. A folder that cannot be watched is logged and left unwatched. */
function watchFolder(folder: string, onChange: (relativePath: string) => void, logger: ILogger): () => void {
  try {
    // PLATFORM: recursive fs.watch needs macOS, Windows or Node 20+ on Linux.
    const watcher = watch(folder, { recursive: true }, (_event, name) => {
      if (name) { onChange(name.split(path.sep).join("/")); }
    });
    watcher.on("error", (error) => void logger.error(LOG_MODULE, error, { folder, action: "watch project folder" }));
    return () => watcher.close();
  } catch (error) {
    void logger.error(LOG_MODULE, error, { folder, action: "start watching project folder" });
    return () => undefined;
  }
}

/** The disk of the project folder at the absolute path `folder`. */
export function createNodeMirrorFileSystem(folder: string, logger: ILogger): MirrorFileSystem {
  const full = (relative: string) => path.join(folder, ...relative.split("/"));
  const assertRoot = () => assertProjectDirReadable(nodeFileReads, folder);
  return {
    async read(relative, stableMs) {
      try {
        const read = await readDisk(full(relative), stableMs);
        // TRAP: a file inside a deleted folder reads as missing too.
        if (read.state === "missing") { await assertRoot(); }
        return read;
      } catch (error) {
        if (!(error instanceof MirrorProjectDirUnavailable)) { await assertRoot(); }
        throw error;
      }
    },
    async write(relative, bytes) {
      // The atomic write creates parent folders, so a deleted project folder would come back with a single file.
      await assertRoot();
      await writeFileAtomic(full(relative), bytes);
    },
    remove: (relative) => fs.rm(full(relative), { force: true }),
    list: () => listMirrorFiles(nodeFileReads, folder),
    watch: (onChange) => watchFolder(folder, onChange, logger),
  };
}
