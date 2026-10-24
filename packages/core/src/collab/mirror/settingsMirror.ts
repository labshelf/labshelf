// Reconciles labshelf.yaml with the shared settings of the index, keeping each member's own keys.
// CONTRACT: documents/contracts/collaboration.md#settings
import { applySharedSettings, indexSettings, readSettingsMap, sharedSettings, writeSettingsChanges, writeSettingsMap } from "../model/index.js";
import { PROJECT_FILE } from "../../writing/project/index.js";
import { DISK_ORIGIN, hashOf, LOG_MODULE, writeMirrored, type MirrorContext } from "./mirrorContext.js";
import type { DiskRead } from "./fileSystem/index.js";
import type { ReconcileOutcome } from "./pathQueue.js";

export async function reconcileSettings(context: MirrorContext, disk: DiskRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") {
    await logger.log("WARN", LOG_MODULE, "The shared project has no labshelf.yaml; settings not mirrored", { folder: context.folder });
    return "done";
  }
  const yaml = new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes);
  const diskHash = await hashOf(yaml);
  const known = store.known.get(PROJECT_FILE);
  const map = indexSettings(session.index);
  try {
    // A first look takes the share's settings when it has any, so a fresh copy never clears them.
    if (diskHash === known || (known === undefined && map.size > 0)) {
      await writeFromShare(context, yaml, diskHash);
      return "done";
    }
    if (!settled) { context.request(PROJECT_FILE, true); return "done"; }
    const shared = sharedSettings(yaml);
    const base = context.settingsBase;
    // With no base (first look, or an edit made while LabShelf was closed) the file's shared keys are taken whole.
    session.index.transact(() => (base ? writeSettingsChanges(map, shared, base) : writeSettingsMap(map, shared)), DISK_ORIGIN);
    await logger.log("INFO", LOG_MODULE, "Took labshelf.yaml edits into the shared settings", { folder: context.folder, keys: Object.keys(shared) });
    await writeFromShare(context, yaml, diskHash);
  } catch (error) {
    await logger.log("WARN", LOG_MODULE, "Left labshelf.yaml out of the share until it is valid", { folder: context.folder, error: String(error) });
  }
  return "done";
}

/** Writes the index's settings into the file, keeping its own keys, and records them as the agreed base. */
async function writeFromShare(context: MirrorContext, yaml: string, diskHash: string): Promise<void> {
  const settings = readSettingsMap(indexSettings(context.session.index));
  const next = applySharedSettings(yaml, settings);
  if (next === yaml) { context.store.known.set(PROJECT_FILE, diskHash); } else { await writeMirrored(context, PROJECT_FILE, next); }
  context.settingsBase = settings;
}
