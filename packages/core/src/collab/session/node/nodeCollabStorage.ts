// Stores a share's collaboration state as files in its device-local state folder, each doc under a stem of the wire doc id.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { CollabDeviceStateStorage, StoredDoc } from "../index.js";

// CONTRACT: documents/contracts/collaboration.md#messages
/** The doc id in hex, computed synchronously because a share session creates docs synchronously. */
export function deriveDocFileStem(shareId: string, docKey: string): string {
  return createHash("sha256").update(`${shareId}\0${docKey}`).digest("hex").slice(0, 32);
}

// CONTRACT: documents/contracts/collaboration.md#device-local-state
const LENGTH_BYTES = 4;

/** One record: the update's length as 4 bytes big-endian, then the update. */
function logRecord(update: Uint8Array): Uint8Array {
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

const DOC_FILE = /^([0-9a-f]{32})\.(snapshot|log)$/;

export interface NodeCollabStorageOptions {
  /** `<state dir>/libraries/<library key>/collab/<share id>/`. */
  dir: string;
  shareId: string;
}

const readOptional = (file: string): Promise<Buffer | undefined> =>
  fs.readFile(file).then((bytes) => bytes, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return undefined; }
    throw error;
  });

async function loadDoc(base: string): Promise<StoredDoc> {
  const snapshot = await readOptional(`${base}.snapshot`);
  const log = await readOptional(`${base}.log`);
  const { updates, torn } = log ? readRecords(new Uint8Array(log)) : { updates: [], torn: false };
  return { ...(snapshot ? { snapshot: new Uint8Array(snapshot) } : {}), updates, torn };
}

export function createNodeCollabStorage({ dir, shareId }: NodeCollabStorageOptions): CollabDeviceStateStorage {
  const docsDir = path.join(dir, "docs");
  const docBase = (docId: string) => path.join(docsDir, docId);
  const mapFile = (name: string) => path.join(dir, `${name}.json`);
  return {
    docId: (docKey) => deriveDocFileStem(shareId, docKey),
    loadDocs: async () => {
      await fs.mkdir(docsDir, { recursive: true });
      const docIds = new Set((await fs.readdir(docsDir)).flatMap((name) => DOC_FILE.exec(name)?.[1] ?? []));
      const docs = new Map<string, StoredDoc>();
      for (const docId of docIds) { docs.set(docId, await loadDoc(docBase(docId))); }
      return docs;
    },
    compactDoc: async (docId, state) => {
      await writeFileAtomic(`${docBase(docId)}.snapshot`, state);
      await fs.rm(`${docBase(docId)}.log`, { force: true });
    },
    appendUpdate: (docId, update) => fs.appendFile(`${docBase(docId)}.log`, logRecord(update)),
    loadMap: async (name) => {
      const text = await readOptional(mapFile(name));
      return text === undefined ? undefined : JSON.parse(text.toString("utf8")) as unknown;
    },
    saveMap: (name, entries) => writeFileAtomic(mapFile(name), JSON.stringify(entries)),
    readBlob: async (hash) => {
      const bytes = await readOptional(path.join(dir, "blobs", hash));
      return bytes && new Uint8Array(bytes);
    },
    writeBlob: (hash, bytes) => writeFileAtomic(path.join(dir, "blobs", hash), bytes),
  };
}
