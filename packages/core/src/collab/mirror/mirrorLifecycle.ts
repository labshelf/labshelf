// Stops a project mirror when its folder or ownership is lost.
import type { WriteRecordStore } from "../../library/writeRecords/index.js";
import { MirrorOwnershipLost } from "./mirrorLostError.js";
import { MirrorRootUnavailable, type MirrorDisk } from "./fileSystem/index.js";
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
      if (!(error instanceof MirrorOwnershipLost) && !(error instanceof MirrorRootUnavailable)) { throw error; }
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

export function gateDisk(disk: MirrorDisk, gate: () => Promise<void>): MirrorDisk {
  return {
    read: (path, stableMs) => disk.read(path, stableMs),
    write: async (path, bytes) => { await gate(); await disk.write(path, bytes); },
    remove: async (path) => { await gate(); await disk.remove(path); },
    list: () => disk.list(),
  };
}

export function gateWriteRecords(records: WriteRecordStore, gate: () => Promise<void>, disk: MirrorDisk): WriteRecordStore {
  return {
    read: () => records.read(),
    append: async (entry) => { await gate(); await disk.list(); await records.append(entry); },
  };
}
