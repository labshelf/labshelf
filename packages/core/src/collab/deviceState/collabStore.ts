// Persists a share's device-local collaboration state.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import * as Y from "yjs";
import { base64ToBytes, bytesToBase64, isCanonicalBase64 } from "../../encoding/index.js";
import { readShareIndexDocFiles } from "../model/index.js";
import type { ILogger } from "../../ports/index.js";
import type { RelayCursorStore } from "../relays/index.js";
import { INDEX_DOC_KEY } from "../doc/index.js";
import { ShareBlobCache } from "./ShareBlobCache.js";
import type { CollabDeviceStateStorage } from "./collabStorage.js";
import { PersistedMap } from "./storedMap.js";
import { loadVersionHistory, type StoredVersion } from "./versionHistory.js";

/** By doc id; the log of each doc is merged into its snapshot, so the log only ever holds what came after this load. */
async function loadStoredDocStates(storage: CollabDeviceStateStorage, logger: ILogger): Promise<Map<string, Uint8Array>> {
  const states = new Map<string, Uint8Array>();
  for (const [docId, { snapshot, updates, torn }] of await storage.loadDocs()) {
    if (torn) { await logger.log("WARN", LOG_MODULE, "Dropped a torn final record of a doc log", { docId }); }
    if (updates.length === 0 && !torn) {
      if (snapshot) { states.set(docId, snapshot); }
      continue;
    }
    const merged = Y.mergeUpdates(snapshot ? [snapshot, ...updates] : updates);
    await storage.compactDoc(docId, merged);
    await logger.log("INFO", LOG_MODULE, "Compacted a doc log into its snapshot", { docId, records: updates.length });
    states.set(docId, merged);
  }
  return states;
}

interface DocPersistenceOptions {
  storage: CollabDeviceStateStorage;
  docId: string;
  docKey: string;
  logger: ILogger;
  /** Updates with this origin are already stored. */
  storedOrigin: unknown;
}

interface DocPersistence {
  readonly docKey: string;
  /** True while an update of the doc is not known to be stored. */
  readonly unstored: boolean;
  /** Queues a full-state write when an update is not stored. */
  retry(): void;
  /** Resolves when every write queued so far has settled. */
  settled(): Promise<void>;
  stop(): void;
}

function persistDoc(doc: Y.Doc, { storage, docId, docKey, logger, storedOrigin }: DocPersistenceOptions): DocPersistence {
  let chain = Promise.resolve();
  let seen = 0;
  let stored = 0;
  // INVARIANT: after a failed write the log may end in a partial record, so nothing is appended until a full-state
  // write replaces the log; this keeps a torn record the last one and keeps every later update out of the gap.
  let failed = false;

  const write = async (update: Uint8Array | undefined, seq: number) => {
    if (seq <= stored) { return; }
    const whole = failed || !update;
    try {
      if (whole) {
        const covered = seen;
        await storage.compactDoc(docId, Y.encodeStateAsUpdate(doc));
        stored = covered;
        failed = false;
        await logger.log("INFO", LOG_MODULE, "Stored the full state of a doc after a failed write", { docKey, docId });
      } else {
        await storage.appendUpdate(docId, update);
        stored = seq;
      }
    } catch (error) {
      failed = true;
      await logger.error(LOG_MODULE, error, { docKey, docId, action: whole ? "store doc state" : "append doc update" });
    }
  };
  const enqueue = (update: Uint8Array | undefined, seq: number) => { chain = chain.then(() => write(update, seq)); };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === storedOrigin) { return; }
    seen += 1;
    enqueue(update, seen);
  };
  doc.on("update", onUpdate);

  return {
    docKey,
    get unstored() { return stored < seen; },
    retry: () => { if (stored < seen) { enqueue(undefined, seen); } },
    settled: async () => {
      let current: Promise<void>;
      do { current = chain; await current; } while (current !== chain);
    },
    stop: () => doc.off("update", onUpdate),
  };
}

const LOG_MODULE = "collab.state";
/** Marks the stored state applied on load, so it is not stored again. */
const RESTORED = Symbol("restored");

export interface CollabStoreOptions {
  storage: CollabDeviceStateStorage;
  logger: ILogger;
}

export interface CollabStore {
  /** The index doc holding its stored state; pass it to createShareSession. */
  readonly index: Y.Doc;
  /** Creates a file doc holding its stored state; pass it to createShareSession. */
  createDoc(path: string): Y.Doc;
  readonly blobs: ShareBlobCache;
  /** Per shared path, the SHA-256 of the content disk and doc last agreed on. */
  readonly known: PersistedMap<string>;
  readonly bases: PersistedMap<string>;
  rememberVersion(path: string, hash: string, text: string): void;
  storedVersions(path: string): readonly StoredVersion[];
  /** The relay cursor of each doc on one relay, saved only while every doc update is stored, and the state the relay holds. */
  relayCursors(relayUrl: string): RelayCursorStore;
  /** Retries unstored doc updates and waits for every pending write; rejects when any state stays unstored. */
  flush(): Promise<void>;
  /** Flushes and stops storing updates; rejects as flush does. */
  close(): Promise<void>;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCursor = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

// Bytes that fail to decode make the caller log the held state as unreadable instead of dropping it silently.
const heldBytes = (value: string): Uint8Array => isCanonicalBase64(value) ? base64ToBytes(value) : new Uint8Array();

function cursorsOf(cursors: PersistedMap<number>, held: PersistedMap<string>, relayUrl: string): RelayCursorStore {
  // INVARIANT: a URL holds no space, so the `<relay url> <doc key>` keys of two relays never collide.
  const key = (docKey: string) => `${relayUrl} ${docKey}`;
  return {
    get: (docKey) => cursors.get(key(docKey)),
    set: (docKey, cursor) => cursors.set(key(docKey), cursor),
    held: (docKey) => { const value = held.get(key(docKey)); return value === undefined ? undefined : heldBytes(value); },
    setHeld: (docKey, snapshot) => held.set(key(docKey), bytesToBase64(snapshot)),
  };
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
  const bases = await PersistedMap.load({ storage, name: "bases", label: "file merge bases", isValue: isString, logger });
  const versions = await loadVersionHistory(storage, logger);
  const cursors = await PersistedMap.load({
    storage, name: "relay-cursors", label: "relay cursors", isValue: isCursor, logger, maySave: allDocsStored,
  });
  // The held state describes the relay, not this device's docs, so it saves without waiting for doc updates.
  const held = await PersistedMap.load({ storage, name: "relay-held", label: "relay held states", isValue: isString, logger });

  function restore(docKey: string): Y.Doc {
    const doc = new Y.Doc();
    const docId = storage.docId(docKey);
    const state = stored.get(docId);
    if (state) { Y.applyUpdate(doc, state, RESTORED); stored.delete(docId); }
    docs.push(persistDoc(doc, { storage, docId, docKey, logger, storedOrigin: RESTORED }));
    return doc;
  }

  const flush = () => flushAll(docs, [known, bases, versions, cursors, held]);
  await logger.log("INFO", LOG_MODULE, "Opened the share state", { docs: stored.size });
  const index = restore(INDEX_DOC_KEY);
  readShareIndexDocFiles(index);
  return {
    index,
    createDoc: (docPath) => restore(docPath),
    blobs: new ShareBlobCache(storage, logger),
    known, bases,
    rememberVersion: versions.rememberVersion,
    storedVersions: versions.storedVersions,
    relayCursors: (relayUrl) => cursorsOf(cursors, held, relayUrl),
    flush,
    close: async () => {
      try { await flush(); } finally { docs.forEach((doc) => doc.stop()); }
    },
  };
}
