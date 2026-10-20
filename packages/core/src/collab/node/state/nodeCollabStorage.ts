// Stores a share's collaboration state as files in its device-local state folder.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { CollabStateStorage, StoredDoc } from "../../state/index.js";
import { docFileStem } from "./docFileStem.js";
import { logRecord, readRecords } from "./docLog.js";

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

export function nodeCollabStorage({ dir, shareId }: NodeCollabStorageOptions): CollabStateStorage {
  const docsDir = path.join(dir, "docs");
  const docBase = (docId: string) => path.join(docsDir, docId);
  const mapFile = (name: string) => path.join(dir, `${name}.json`);
  return {
    docId: (docKey) => docFileStem(shareId, docKey),
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
