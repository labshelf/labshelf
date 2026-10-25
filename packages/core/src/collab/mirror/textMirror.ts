// Reconciles a shared text file with its disk copy while preserving edits across versions.
import { waitsForWrite } from "./waitForWrite.js";
import { fileText, indexFiles, replaceFileText, writtenHashes } from "../model/index.js";
import { DISK_ORIGIN, forget, hashOf, LOG_MODULE, rememberMirrored, writeMirrored, type MirrorContext } from "./mirrorContext.js";
import { mergeDiskText } from "./findMergeBase.js";
import type { DiskRead } from "./fileSystem/index.js";
import type { ReconcileOutcome } from "./pathQueue.js";

const decodeText = (bytes: Uint8Array): string | undefined => {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
};

export async function reconcileText(context: MirrorContext, path: string, disk: DiskRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  const known = store.known.get(path);
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") { return reconcileMissing(context, path, settled); }
  const diskText = decodeText(disk.bytes);
  // TRAP: A text file cut inside a UTF-8 sequence is mid-write.
  if (diskText === undefined) { return settled ? "changing" : (context.request(path, true), "done"); }
  const diskHash = await hashOf(diskText);
  const doc = session.openDoc(path);
  const docText = fileText(doc).toString();
  if (diskText === docText) { rememberMirrored(context, path, docText, diskHash); return "done"; }
  if (diskHash === known) { await writeMirrored(context, path, docText); return "done"; }
  if (!settled) { context.request(path, true); return "done"; }
  if (doc.store.clients.size === 0) {
    await logger.log("INFO", LOG_MODULE, "Kept a local file until its doc syncs", { folder: context.folder, path });
    return "done";
  }
  if (writtenHashes(session.index, path).has(diskHash)) {
    await writeMirrored(context, path, docText);
    await logger.log("INFO", LOG_MODULE, "Wrote the shared text over an old version on disk", { path, diskHash });
    return "done";
  }
  const entry = indexFiles(session.index).get(path);
  const wait = await waitsForWrite(context, path, diskHash);
  if (wait.waiting) { return "done"; }
  if (indexFiles(session.index).get(path) !== entry) { context.request(path, false); return "done"; }
  return takeOutsideText(context, path, diskText, diskHash, wait.parent);
}

async function takeOutsideText(context: MirrorContext, path: string, diskText: string, diskHash: string, parent?: string): Promise<ReconcileOutcome> {
  const { session, logger } = context;
  const doc = session.openDoc(path);
  const docText = fileText(doc).toString();
  if (writtenHashes(session.index, path).has(diskHash)) { context.request(path, false); return "done"; }
  const merged = mergeDiskText(context, path, docText, diskText, parent);
  const next = merged?.text ?? diskText;
  // INVARIANT: No await separates reading the doc for merging from applying the outside edit.
  replaceFileText(doc, next, DISK_ORIGIN);
  if (next === diskText) { rememberMirrored(context, path, next, diskHash); } else { await writeMirrored(context, path, next); }
  if (!merged || merged.conflicted) {
    const message = merged ? "Doc and disk changed the same lines; marked both" : "Doc and disk both changed with no common text; took the disk text";
    await logger.log("WARN", LOG_MODULE, message, { folder: context.folder, path });
  }
  await logger.log("INFO", LOG_MODULE, "Took an outside edit into the share", { folder: context.folder, path, length: next.length });
  return "done";
}

async function reconcileMissing(context: MirrorContext, path: string, settled: boolean): Promise<ReconcileOutcome> {
  if (context.store.known.get(path) === undefined) {
    await writeMirrored(context, path, fileText(context.session.openDoc(path)).toString());
    return "done";
  }
  if (!settled) { context.request(path, true); return "done"; }
  context.session.index.transact(() => indexFiles(context.session.index).delete(path), DISK_ORIGIN);
  forget(context, path);
  await context.logger.log("INFO", LOG_MODULE, "Removed a file deleted on disk from the share", { folder: context.folder, path });
  return "done";
}
