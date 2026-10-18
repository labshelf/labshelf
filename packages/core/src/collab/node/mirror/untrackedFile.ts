// Reconciles a file on disk that the index does not list: a new file to share, or one the share removed.
import { indexFiles, replaceFileText, sharedFileKind, sharedPaths, type ShareFileEntry } from "../../model/index.js";
import { deleteMirrored, DISK_ORIGIN, forget, hashOf, LOG_MODULE, type MirrorContext } from "./mirrorContext.js";
import type { DiskRead, ReconcileOutcome } from "./watch/index.js";

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
  const kind = sharedFileKind(path, disk.bytes);
  let entry: ShareFileEntry = { kind };
  if (kind === "text") {
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes);
    replaceFileText(session.openDoc(path), text, DISK_ORIGIN);
    context.bases.set(path, text);
  } else {
    entry = { kind, hash: await store.blobs.put(disk.bytes) };
  }
  session.index.transact(() => indexFiles(session.index).set(path, entry), DISK_ORIGIN);
  store.known.set(path, diskHash);
  context.attach(path);
  if (known !== undefined) {
    await logger.log("WARN", LOG_MODULE, "Shared again a file the share removed but this device changed", { folder: context.folder, path });
  }
  await logger.log("INFO", LOG_MODULE, "Added a new file on disk to the share", { folder: context.folder, path, kind });
  return "done";
}
