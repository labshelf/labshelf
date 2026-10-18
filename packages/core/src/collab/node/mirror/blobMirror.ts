// Reconciles one shared binary file between its index entry, the blob cache and its disk copy.
import { indexFiles, type ShareFileEntry } from "../../model/index.js";
import { DISK_ORIGIN, forget, hashOf, LOG_MODULE, writeMirrored, type MirrorContext } from "./mirrorContext.js";
import type { DiskRead, ReconcileOutcome } from "./watch/index.js";

export async function reconcileBlob(
  context: MirrorContext, path: string, entry: ShareFileEntry, disk: DiskRead, settled: boolean,
): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  const known = store.known.get(path);
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "present") {
    const diskHash = await hashOf(disk.bytes);
    if (diskHash === entry.hash) { await store.blobs.put(disk.bytes); store.known.set(path, diskHash); return "done"; }
    if (diskHash !== known) {
      if (!settled) { context.request(path, true); return "done"; }
      await store.blobs.put(disk.bytes);
      session.index.transact(() => indexFiles(session.index).set(path, { kind: "blob", hash: diskHash }), DISK_ORIGIN);
      store.known.set(path, diskHash);
      await logger.log("INFO", LOG_MODULE, "Took an outside change of a binary file into the share", { folder: context.folder, path, hash: diskHash });
      return "done";
    }
  } else if (known !== undefined) {
    if (!settled) { context.request(path, true); return "done"; }
    session.index.transact(() => indexFiles(session.index).delete(path), DISK_ORIGIN);
    forget(context, path);
    await logger.log("INFO", LOG_MODULE, "Removed a file deleted on disk from the share", { folder: context.folder, path });
    return "done";
  }
  await writeFetched(context, path, entry);
  return "done";
}

async function writeFetched(context: MirrorContext, path: string, entry: ShareFileEntry): Promise<void> {
  const { session, store, logger } = context;
  const hash = entry.hash;
  if (hash === undefined) { return void await logger.log("WARN", LOG_MODULE, "Skipped a binary file listed without a hash", { path }); }
  const bytes = await store.blobs.get(hash) ?? await fetched(context, path, hash);
  if (!bytes) { return; }
  if (await hashOf(bytes) !== hash) { return void await logger.log("WARN", LOG_MODULE, "Refused a blob whose bytes do not match its hash", { path, hash }); }
  await store.blobs.put(bytes);
  // The entry may have moved on while the blob travelled.
  if (indexFiles(session.index).get(path)?.hash !== hash) { return context.request(path, false); }
  context.missingBlobs.delete(path);
  await writeMirrored(context, path, bytes);
}

async function fetched(context: MirrorContext, path: string, hash: string): Promise<Uint8Array | undefined> {
  try {
    return await context.blobs.fetch(hash);
  } catch (error) {
    context.missingBlobs.add(path);
    await context.logger.log("WARN", LOG_MODULE, "Could not fetch a blob; retrying when a peer joins", { path, hash, error: String(error) });
    return undefined;
  }
}
