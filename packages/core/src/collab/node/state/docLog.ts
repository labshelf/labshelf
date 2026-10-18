// Stores one doc's Yjs state as a snapshot plus an append-only log of updates, merged into the snapshot on load.
import { promises as fs } from "node:fs";
import * as Y from "yjs";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";

const LOG_MODULE = "collab.state";
const LENGTH_BYTES = 4;

const readOptional = (file: string): Promise<Uint8Array | undefined> =>
  fs.readFile(file).then((bytes) => new Uint8Array(bytes), (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return undefined; }
    throw error;
  });

/** One record: the update's length as 4 bytes big-endian, then the update. */
export function logRecord(update: Uint8Array): Uint8Array {
  const record = new Uint8Array(LENGTH_BYTES + update.length);
  new DataView(record.buffer).setUint32(0, update.length);
  record.set(update, LENGTH_BYTES);
  return record;
}

/** The complete records of a log; a torn final record from an interrupted append is reported as `torn`. */
function readRecords(log: Uint8Array): { updates: Uint8Array[]; torn: boolean } {
  const updates: Uint8Array[] = [];
  const view = new DataView(log.buffer, log.byteOffset, log.byteLength);
  let offset = 0;
  while (offset + LENGTH_BYTES <= log.length) {
    const length = view.getUint32(offset);
    if (offset + LENGTH_BYTES + length > log.length) { break; }
    updates.push(log.subarray(offset + LENGTH_BYTES, offset + LENGTH_BYTES + length));
    offset += LENGTH_BYTES + length;
  }
  return { updates, torn: offset < log.length };
}

/**
 * The doc's stored state as one update, or undefined when nothing is stored. A non-empty log is merged into the
 * snapshot and removed, so the log only ever holds what came after the last start.
 */
export async function loadDocState(base: string, logger: ILogger): Promise<Uint8Array | undefined> {
  const snapshotPath = `${base}.snapshot`;
  const logPath = `${base}.log`;
  const snapshot = await readOptional(snapshotPath);
  const log = await readOptional(logPath);
  if (!log) { return snapshot; }
  const { updates, torn } = readRecords(log);
  if (torn) { await logger.log("WARN", LOG_MODULE, "Dropped a torn final record of a doc log", { log: logPath, bytes: log.length }); }
  const merged = Y.mergeUpdates(snapshot ? [snapshot, ...updates] : updates);
  await writeFileAtomic(snapshotPath, merged);
  await fs.rm(logPath, { force: true });
  await logger.log("INFO", LOG_MODULE, "Compacted a doc log into its snapshot", { snapshot: snapshotPath, records: updates.length });
  return merged;
}
