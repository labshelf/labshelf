// Reconciles a file on disk that the index does not list: a new file to share, or one the share removed.
import { waitsForWrite } from "./inFlight/index.js";
import { indexFiles, replaceFileText, sharedFileKind, sharedPaths, type ShareFileEntry } from "../../model/index.js";
import { deleteMirrored, DISK_ORIGIN, forget, hashOf, LOG_MODULE, rememberMirrored, type MirrorContext } from "./mirrorContext.js";
import type { DiskRead } from "../disk/index.js";
import type { ReconcileOutcome } from "./pathQueue.js";

export async function reconcileUntracked(context: MirrorContext, path: string, disk: DiskRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") { forget(context, path); return "done"; }
  const diskHash = await hashOf(disk.bytes);
  const known = store.known.get(path);
  // The share removed a file this device still holds as last synced, so the removal applies here too.
  if (known === diskHash) { await deleteMirrored(context, path); return "done"; }
  if (sharedPaths([path]).length === 0) { return "done"; }
  if (!settled) { context.request(path, true); return "done"; }
  if ((await waitsForWrite(context, path, diskHash)).waiting) { return "done"; }
  if (indexFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  const kind = sharedFileKind(path, disk.bytes);
  const content = kind === "text" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : disk.bytes;
  let entry: ShareFileEntry = { kind };
  if (typeof content === "string") {
    replaceFileText(session.openDoc(path), content, DISK_ORIGIN);
  } else {
    entry = { kind, hash: await store.blobs.put(disk.bytes) };
  }
  if (indexFiles(session.index).has(path)) { context.request(path, false); return "done"; }
  session.index.transact(() => indexFiles(session.index).set(path, entry), DISK_ORIGIN);
  rememberMirrored(context, path, content, diskHash);
  context.attach(path);
  if (known !== undefined) {
    await logger.log("WARN", LOG_MODULE, "Shared again a file the share removed but this device changed", { folder: context.folder, path });
  }
  await logger.log("INFO", LOG_MODULE, "Added a new file on disk to the share", { folder: context.folder, path, kind });
  return "done";
}
