// Stops a project mirror when its folder or ownership is lost.
import type { WriteRecordStore } from "../../library/mutations/index.js";
import { MirrorLostError } from "./MirrorLostError.js";
import { MirrorProjectDirUnavailable, type MirrorFileSystem } from "./fileSystem/index.js";
import { LOG_MODULE } from "./mirrorContext.js";
import type { ProjectMirrorOptions, MirrorStopReason } from "./projectMirror.js";

export function createMirrorLifecycle(options: ProjectMirrorOptions, detach: (() => void)[], stopQueue: () => void) {
  let stopped: MirrorStopReason | undefined;
  const gate = async () => {
    if (stopped) { throw stopped; }
    await options.ownership?.assertOwned();
  };
  async function guarded<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try { return await work(); } catch (error) {
      if (!(error instanceof MirrorLostError) && !(error instanceof MirrorProjectDirUnavailable)) { throw error; }
      if (!stopped) {
        stopped = error;
        detach.splice(0).forEach((stop) => stop());
        // TRAP: The queue cannot await its own running reconcile.
        stopQueue();
        void options.logger.log("WARN", LOG_MODULE, "Stopped mirroring a shared project", { folder: options.folder, reason: error.name, message: error.message });
        options.onStopped?.(error);
      }
      return fallback;
    }
  }
  return { gate, guarded, isStopped: () => stopped !== undefined };
}

export function withGatedFileSystem(disk: MirrorFileSystem, gate: () => Promise<void>): MirrorFileSystem {
  return {
    read: (path, stableMs) => disk.read(path, stableMs),
    write: async (path, bytes) => { await gate(); await disk.write(path, bytes); },
    remove: async (path) => { await gate(); await disk.remove(path); },
    list: () => disk.list(),
  };
}

export function withGatedWriteRecords(records: WriteRecordStore, gate: () => Promise<void>, disk: MirrorFileSystem): WriteRecordStore {
  return {
    read: () => records.read(),
    append: async (entry) => { await gate(); await disk.list(); await records.append(entry); },
  };
}
