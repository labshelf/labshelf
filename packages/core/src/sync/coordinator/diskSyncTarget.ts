// Builds the SyncTarget of a library that lives on a local disk, shared with other apps through a lock file.
import type { LocalFileSystem, LockStore } from "../../ports/index.js";
import { syncRoots, type LibraryLayout } from "../../library/index.js";
import type { SyncTarget } from "./types.js";

export interface DiskSyncTargetOptions<T> {
  files: LocalFileSystem;
  layout: LibraryLayout<T>;
  /** Turns the layout's path type (a URI in VS Code) into the filesystem path the engine reads. */
  toPath(path: T): string;
  lock: { store: LockStore; isProcessAlive(pid: number): boolean };
}

export function diskSyncTarget<T>({ files, layout, toPath, lock }: DiskSyncTargetOptions<T>): SyncTarget {
  const roots = syncRoots(layout);
  return {
    files,
    roots: { library: toPath(roots.library), appdata: toPath(roots.appdata) },
    state: { fs: files, manifestPath: toPath(layout.manifestPath()), lastRunPath: toPath(layout.lastRunPath()) },
    lock: { ...lock, path: toPath(layout.lockPath()) },
  };
}
