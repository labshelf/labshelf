// Reconciles one shared text file between its doc and its disk copy.
import { fileText, indexFiles, replaceFileText } from "../../model/index.js";
import { mergeText } from "../../../writing/merge/node/index.js";
import { DISK_ORIGIN, forget, hashOf, LOG_MODULE, writeMirrored, type MirrorContext } from "./mirrorContext.js";
import type { DiskRead, ReconcileOutcome } from "./watch/index.js";

const decodeText = (bytes: Uint8Array): string | undefined => {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
};

/** A doc that never received an update is still waiting for its peers, so disk text must not be fed into it yet. */
const awaitsSync = (doc: { store: { clients: Map<number, unknown> } }) => doc.store.clients.size === 0;

export async function reconcileText(context: MirrorContext, path: string, disk: DiskRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  const doc = session.openDoc(path);
  const docText = fileText(doc).toString();
  const known = store.known.get(path);
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") {
    if (known === undefined) { await writeMirrored(context, path, docText); return "done"; }
    if (!settled) { context.request(path, true); return "done"; }
    session.index.transact(() => indexFiles(session.index).delete(path), DISK_ORIGIN);
    forget(context, path);
    await logger.log("INFO", LOG_MODULE, "Removed a file deleted on disk from the share", { folder: context.folder, path });
    return "done";
  }
  const diskText = decodeText(disk.bytes);
  // A text file cut inside a UTF-8 sequence is mid-write.
  if (diskText === undefined) { return settled ? "changing" : (context.request(path, true), "done"); }
  const diskHash = await hashOf(diskText);
  if (diskText === docText) { store.known.set(path, diskHash); context.bases.set(path, docText); return "done"; }
  if (diskHash === known) { await writeMirrored(context, path, docText); return "done"; }
  if (!settled) { context.request(path, true); return "done"; }
  if (awaitsSync(doc)) {
    await logger.log("INFO", LOG_MODULE, "Kept a local file until its doc syncs", { folder: context.folder, path });
    return "done";
  }
  const next = await mergedWithDoc(context, path, { docText, diskText, known });
  replaceFileText(doc, next, DISK_ORIGIN);
  if (next === diskText) { store.known.set(path, diskHash); context.bases.set(path, next); } else { await writeMirrored(context, path, next); }
  await logger.log("INFO", LOG_MODULE, "Took an outside edit into the share", { folder: context.folder, path, length: next.length });
  return "done";
}

/** The disk text, merged with the doc's own changes when both moved on since they last agreed. */
async function mergedWithDoc(
  context: MirrorContext, path: string, { docText, diskText, known }: { docText: string; diskText: string; known: string | undefined },
): Promise<string> {
  if (known === undefined || await hashOf(docText) === known) { return diskText; }
  const base = context.bases.get(path);
  if (base === undefined) {
    await context.logger.log("WARN", LOG_MODULE, "Doc and disk both changed with no common text; took the disk text", { folder: context.folder, path });
    return diskText;
  }
  const merged = mergeText({ base, local: docText, other: diskText, otherLabel: "disk" });
  if (merged.conflicted) {
    await context.logger.log("WARN", LOG_MODULE, "Doc and disk changed the same lines; marked both", { folder: context.folder, path });
  }
  return merged.text;
}
