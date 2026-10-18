// Persists a share's Yjs docs and blobs in its device-local state folder, so a restart restores them without a peer.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import type { ILogger } from "../../../ports/index.js";
import type { RelayCursorStore } from "../../sync/index.js";
import { INDEX_DOC_KEY } from "../../sync/index.js";
import { BlobCache } from "./blobCache.js";
import { docFileStem } from "./docFileStem.js";
import { loadDocState, logRecord } from "./docLog.js";
import { JsonMapFile } from "./jsonMapFile.js";

const LOG_MODULE = "collab.state";
/** Marks the stored state applied on load, so it is not appended to the log again. */
const RESTORED = Symbol("restored");

export interface CollabStoreOptions {
  /** `<state dir>/libraries/<library key>/collab/<share id>/`. */
  dir: string;
  shareId: string;
  logger: ILogger;
}

export interface CollabStore {
  /** The index doc holding its stored state; pass it to createShareSession. */
  readonly index: Y.Doc;
  /** Creates a file doc holding its stored state; pass it to createShareSession. */
  createDoc(path: string): Y.Doc;
  readonly blobs: BlobCache;
  /** Per shared path, the SHA-256 of the content disk and doc last agreed on. */
  readonly known: JsonMapFile<string>;
  /** The relay cursor of each doc, saved only after the doc updates it covers are on disk. */
  readonly relayCursors: RelayCursorStore;
  /** Waits for every pending append and save. */
  flush(): Promise<void>;
  /** Flushes and stops storing updates. */
  close(): Promise<void>;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCursor = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

async function loadAll(docsDir: string, logger: ILogger): Promise<Map<string, Uint8Array>> {
  await fs.mkdir(docsDir, { recursive: true });
  const stems = new Set((await fs.readdir(docsDir)).flatMap((name) => /^([0-9a-f]{32})\.(snapshot|log)$/.exec(name)?.[1] ?? []));
  const stored = new Map<string, Uint8Array>();
  for (const stem of stems) {
    const state = await loadDocState(path.join(docsDir, stem), logger);
    if (state) { stored.set(stem, state); }
  }
  return stored;
}

export async function openCollabStore({ dir, shareId, logger }: CollabStoreOptions): Promise<CollabStore> {
  const docsDir = path.join(dir, "docs");
  const stored = await loadAll(docsDir, logger);
  const known = await JsonMapFile.load({ file: path.join(dir, "known.json"), label: "known file hashes", isValue: isString, logger });
  const pending = new Set<Promise<void>>();
  const appended = async () => { while (pending.size > 0) { await Promise.all([...pending]); } };
  const relayCursors = await JsonMapFile.load({ file: path.join(dir, "relay-cursors.json"), label: "relay cursors", isValue: isCursor, logger, beforeSave: appended });
  const detach: (() => void)[] = [];

  function restore(docKey: string): Y.Doc {
    const doc = new Y.Doc();
    const stem = docFileStem(shareId, docKey);
    const state = stored.get(stem);
    if (state) { Y.applyUpdate(doc, state, RESTORED); stored.delete(stem); }
    const logPath = path.join(docsDir, `${stem}.log`);
    let chain = Promise.resolve();
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === RESTORED) { return; }
      // INVARIANT: appends of one doc run in order, so a torn record can only be the last one.
      chain = chain.then(() => fs.appendFile(logPath, logRecord(update))).catch((error: unknown) =>
        logger.error(LOG_MODULE, error, { docKey, log: logPath, action: "append doc update" }));
      const done = chain;
      pending.add(done);
      void done.then(() => pending.delete(done));
    };
    doc.on("update", onUpdate);
    detach.push(() => doc.off("update", onUpdate));
    return doc;
  }

  const flush = async () => {
    await appended();
    await Promise.all([known.flush(), relayCursors.flush()]);
  };
  await logger.log("INFO", LOG_MODULE, "Opened the share state", { dir, docs: stored.size });
  return {
    index: restore(INDEX_DOC_KEY),
    createDoc: (docPath) => restore(docPath),
    blobs: new BlobCache(path.join(dir, "blobs")),
    known,
    relayCursors,
    flush,
    close: async () => {
      await flush();
      detach.forEach((stop) => stop());
    },
  };
}
