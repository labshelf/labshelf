// Keeps a share's Yjs docs, blobs, known hashes and relay cursors on this device, so a restart restores them without a peer.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { RelayCursorStore } from "../sync/index.js";
import { INDEX_DOC_KEY } from "../sync/index.js";
import { BlobCache } from "./blobCache.js";
import type { CollabStateStorage } from "./collabStateStorage.js";
import { persistDoc, type DocPersistence } from "./docPersistence.js";
import { PersistedMap } from "./persistedMap.js";
import { loadStoredDocStates } from "./storedDocStates.js";

const LOG_MODULE = "collab.state";
/** Marks the stored state applied on load, so it is not stored again. */
const RESTORED = Symbol("restored");

export interface CollabStoreOptions {
  storage: CollabStateStorage;
  logger: ILogger;
}

export interface CollabStore {
  /** The index doc holding its stored state; pass it to createShareSession. */
  readonly index: Y.Doc;
  /** Creates a file doc holding its stored state; pass it to createShareSession. */
  createDoc(path: string): Y.Doc;
  readonly blobs: BlobCache;
  /** Per shared path, the SHA-256 of the content disk and doc last agreed on. */
  readonly known: PersistedMap<string>;
  /** The relay cursor of each doc on one relay, saved only while every doc update is stored. */
  relayCursors(relayUrl: string): RelayCursorStore;
  /** Retries unstored doc updates and waits for every pending write; rejects when any state stays unstored. */
  flush(): Promise<void>;
  /** Flushes and stops storing updates; rejects as flush does. */
  close(): Promise<void>;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCursor = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function cursorsOf(cursors: PersistedMap<number>, relayUrl: string): RelayCursorStore {
  // INVARIANT: a URL holds no space, so the `<relay url> <doc key>` keys of two relays never collide.
  return { get: (docKey) => cursors.get(`${relayUrl} ${docKey}`), set: (docKey, cursor) => cursors.set(`${relayUrl} ${docKey}`, cursor) };
}

async function flushAll(docs: DocPersistence[], maps: { flush(): Promise<void> }[]): Promise<void> {
  docs.forEach((doc) => doc.retry());
  await Promise.all(docs.map((doc) => doc.settled()));
  const results = await Promise.allSettled(maps.map((map) => map.flush()));
  const failures = results.flatMap((result) => result.status === "rejected" ? [String((result.reason as Error).message)] : []);
  const unstored = docs.filter((doc) => doc.unstored).map((doc) => doc.docKey);
  if (unstored.length > 0) { failures.unshift(`updates of ${unstored.join(", ")} are not stored`); }
  if (failures.length > 0) { throw new Error(`The share state is not stored: ${failures.join("; ")}`); }
}

export async function openCollabStore({ storage, logger }: CollabStoreOptions): Promise<CollabStore> {
  const stored = await loadStoredDocStates(storage, logger);
  const docs: DocPersistence[] = [];
  const allDocsStored = async () => {
    await Promise.all(docs.map((doc) => doc.settled()));
    return docs.every((doc) => !doc.unstored);
  };
  const known = await PersistedMap.load({ storage, name: "known", label: "known file hashes", isValue: isString, logger });
  const cursors = await PersistedMap.load({
    storage, name: "relay-cursors", label: "relay cursors", isValue: isCursor, logger, maySave: allDocsStored,
  });

  function restore(docKey: string): Y.Doc {
    const doc = new Y.Doc();
    const docId = storage.docId(docKey);
    const state = stored.get(docId);
    if (state) { Y.applyUpdate(doc, state, RESTORED); stored.delete(docId); }
    docs.push(persistDoc(doc, { storage, docId, docKey, logger, storedOrigin: RESTORED }));
    return doc;
  }

  const flush = () => flushAll(docs, [known, cursors]);
  await logger.log("INFO", LOG_MODULE, "Opened the share state", { docs: stored.size });
  return {
    index: restore(INDEX_DOC_KEY),
    createDoc: (docPath) => restore(docPath),
    blobs: new BlobCache(storage, logger),
    known,
    relayCursors: (relayUrl) => cursorsOf(cursors, relayUrl),
    flush,
    close: async () => {
      try { await flush(); } finally { docs.forEach((doc) => doc.stop()); }
    },
  };
}
