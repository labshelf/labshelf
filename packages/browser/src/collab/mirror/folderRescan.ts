// Finds files changed outside the browser in a mirrored folder by comparing each file's modification time and size between scans.
import { DEVICE_ID, posixPathOps, type ILogger, type LibraryFileSystem, type MirrorFileSystem } from "@labshelf/core";

/** Bounds the stat calls of one scan; a project folder past this is not mirrored in full. */
const RESCAN_MAX_PATHS = 2_000;
const LOG_MODULE = "browser.collab.mirror";

export interface FolderRescanOptions {
  fs: LibraryFileSystem;
  folder: string;
  disk: MirrorFileSystem;
  changed(path: string): void;
  logger: ILogger;
}

export interface FolderRescan {
  /** Reports every path changed, created or deleted since the last scan; the first scan only records. Throws MirrorProjectDirUnavailable. */
  scan(): Promise<void>;
}

export function createFolderRescan(options: FolderRescanOptions): FolderRescan {
  const { fs, folder, disk, changed, logger } = options;
  let known: Map<string, string> | undefined;
  let running: Promise<void> | undefined;

  const fingerprint = async (path: string): Promise<string | undefined> => {
    try {
      const stat = await fs.stat(posixPathOps.join(folder, ...path.split("/")));
      return stat?.isFile === true ? `${stat.mtimeMs}:${stat.size}` : undefined;
    } catch (error) {
      void logger.error(LOG_MODULE, error, { op: "rescanStat", folder, path, note: "kept as unchanged until the next scan" });
      return known?.get(path);
    }
  };

  const run = async (): Promise<void> => {
    const [listed, records] = await Promise.all([disk.list(), fs.listDir(posixPathOps.join(folder, ".labshelf", "writes"))]);
    listed.push(...records.filter(name => name.endsWith(".json") && DEVICE_ID.test(name.slice(0, -5))).map(name => `.labshelf/writes/${name}`));
    if (listed.length > RESCAN_MAX_PATHS) {
      void logger.log("WARN", LOG_MODULE, "Folder rescan covers only the first files", { folder, files: listed.length, max: RESCAN_MAX_PATHS });
    }
    const next = new Map<string, string>();
    for (const path of listed.slice(0, RESCAN_MAX_PATHS)) {
      const print = await fingerprint(path);
      if (print !== undefined) { next.set(path, print); }
    }
    const previous = known;
    known = next;
    if (!previous) { return; }
    for (const [path, print] of next) { if (previous.get(path) !== print) { changed(path); } }
    for (const path of previous.keys()) { if (!next.has(path)) { changed(path); } }
  };

  return {
    scan: () => (running ??= run().finally(() => { running = undefined; })),
  };
}
