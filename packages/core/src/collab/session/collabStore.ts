// Persists a share's device-local collaboration state behind a storage port: docs, blob cache, known file hashes, versions and relay cursors.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import * as Y from "yjs";
import { isCount, isString } from "../../guards/index.js";
import { base64ToBytes, bytesToBase64, isCanonicalBase64 } from "../../encoding/index.js";
import { deriveSha256Hex } from "../../hash/index.js";
import { INDEX_DOC_KEY, readShareIndexDocFiles } from "../doc/index.js";
import type { ILogger } from "../../ports/index.js";
import type { RelayCursorStore } from "../relays/index.js";

const LOG_MODULE = "collab.state";

/** What is stored of one doc: its last compacted state and the updates appended since, in append order. */
export interface StoredDoc {
  snapshot?: Uint8Array;
  updates: Uint8Array[];
  /** An interrupted append left a partial record after `updates`; it is not part of them. */
  torn: boolean;
}

export type DeviceStateMapName = "known" | "versions" | "bases" | "relay-cursors" | "relay-held";

export interface CollabDeviceStateStorage {
  /** The id a doc is stored under; synchronous because a share session creates docs synchronously. */
  docId(docKey: string): string;
  /** Every stored doc by doc id. */
  loadDocs(): Promise<Map<string, StoredDoc>>;
  /** Replaces the doc's stored state with `state` and no updates; a crash leaves either the old or the new state. */
  compactDoc(docId: string, state: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  /** The map as last saved, undefined when none is; rejects on unreadable data. */
  loadMap(name: DeviceStateMapName): Promise<unknown>;
  /** Replaces the map whole; a crash leaves either the old or the new map. */
  saveMap(name: DeviceStateMapName, entries: Record<string, unknown>): Promise<void>;
  /** `hash` is always a lowercase SHA-256 hex, so it is safe as a key or a file name. */
  readBlob(hash: string): Promise<Uint8Array | undefined>;
  writeBlob(hash: string, bytes: Uint8Array): Promise<void>;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export class ShareBlobCache {
  constructor(private readonly storage: CollabDeviceStateStorage, private readonly logger: ILogger) {}

  /** The bytes stored under `hash`; undefined for a hash not held, a corrupt copy, or a string that is no SHA-256 hex. */
  async get(hash: string): Promise<Uint8Array | undefined> {
    if (!HASH_PATTERN.test(hash)) { return undefined; }
    const bytes = await this.storage.readBlob(hash);
    if (!bytes) { return undefined; }
    if (await deriveSha256Hex(bytes) === hash) { return bytes; }
    await this.logger.log("WARN", LOG_MODULE, "Ignored a stored blob whose bytes do not match its hash", { hash, bytes: bytes.length });
    return undefined;
  }

  /** Stores the bytes and returns their hash; a sound copy already held is not written again. */
  async put(bytes: Uint8Array): Promise<string> {
    const hash = await deriveSha256Hex(bytes);
    if (await this.get(hash) === undefined) { await this.storage.writeBlob(hash, bytes); }
    return hash;
  }
}

export interface StoredMapOptions<V> {
  storage: CollabDeviceStateStorage;
  name: DeviceStateMapName;
  /** What the map holds, for log lines and errors. */
  label: string;
  isValue(value: unknown): value is V;
  logger: ILogger;
  /** Resolves false while a save would claim more than other state already stored; the map then stays unsaved. */
  maySave?: () => Promise<boolean>;
}

export class StoredMap<V> {
  private saving: Promise<void> = Promise.resolve();
  private queued = false;
  private changes = 0;
  private savedChanges = 0;

  private constructor(private readonly options: StoredMapOptions<V>, private readonly entries: Map<string, V>) {}

  /** Loads the map; a missing or unreadable one starts empty. */
  static async load<V>(options: StoredMapOptions<V>): Promise<StoredMap<V>> {
    const { storage, name, label, isValue, logger } = options;
    let entries = new Map<string, V>();
    try {
      const stored = await storage.loadMap(name);
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        entries = new Map(Object.entries(stored).filter((entry): entry is [string, V] => isValue(entry[1])));
      } else if (stored !== undefined) {
        await logger.log("WARN", LOG_MODULE, `Ignored ${label} that are not a map`, { name });
      }
    } catch (error) {
      await logger.log("WARN", LOG_MODULE, `Ignored unreadable ${label}`, { name, error: String(error) });
    }
    return new StoredMap(options, entries);
  }

  get(key: string): V | undefined { return this.entries.get(key); }

  set(key: string, value: V): void {
    if (this.entries.get(key) === value) { return; }
    this.entries.set(key, value);
    this.save();
  }

  delete(key: string): void {
    if (this.entries.delete(key)) { this.save(); }
  }

  /** Saves any change not stored yet; rejects when a change stays unsaved. */
  async flush(): Promise<void> {
    if (this.savedChanges < this.changes) { this.queue(); }
    await this.saving;
    if (this.savedChanges < this.changes) { throw new Error(`The ${this.options.label} are not stored`); }
  }

  private save(): void {
    this.changes += 1;
    this.queue();
  }

  /** Coalesces a burst of changes into one save. */
  private queue(): void {
    if (this.queued) { return; }
    this.queued = true;
    const { storage, name, label, logger, maySave } = this.options;
    this.saving = this.saving.then(async () => {
      const allowed = await (maySave?.() ?? Promise.resolve(true));
      this.queued = false;
      if (!allowed) {
        await logger.log("WARN", LOG_MODULE, `Held back saving the ${label} while doc updates are not stored`, { name });
        return;
      }
      const covered = this.changes;
      try {
        await storage.saveMap(name, Object.fromEntries(this.entries));
        this.savedChanges = Math.max(this.savedChanges, covered);
      } catch (error) {
        await logger.error(LOG_MODULE, error, { name, action: `save ${label}` });
      }
    });
  }
}

export const VERSIONS_PER_PATH = 50;
export interface StoredVersion { readonly hash: string; readonly text: string }

function isVersions(value: unknown): value is readonly StoredVersion[] {
  return Array.isArray(value) && value.length <= VERSIONS_PER_PATH && value.every((entry: unknown) =>
    entry !== null && typeof entry === "object" && "hash" in entry && typeof entry.hash === "string"
    && "text" in entry && typeof entry.text === "string");
}

export async function loadVersionHistory(storage: CollabDeviceStateStorage, logger: ILogger) {
  const versions = await StoredMap.load({ storage, name: "versions", label: "stored file versions", isValue: isVersions, logger });
  return {
    storedVersions: (path: string): readonly StoredVersion[] => versions.get(path) ?? [],
    rememberVersion: (path: string, hash: string, text: string): void => {
      const entries = versions.get(path) ?? [];
      if (entries.at(-1)?.hash === hash) { return; }
      versions.set(path, [...entries, { hash, text }].slice(-VERSIONS_PER_PATH));
    },
    flush: () => versions.flush(),
  };
}

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
  readonly known: StoredMap<string>;
  readonly bases: StoredMap<string>;
  rememberVersion(path: string, hash: string, text: string): void;
  storedVersions(path: string): readonly StoredVersion[];
  /** The relay cursor of each doc on one relay, saved only while every doc update is stored, and the state the relay holds. */
  relayCursors(relayUrl: string): RelayCursorStore;
  /** Retries unstored doc updates and waits for every pending write; rejects when any state stays unstored. */
  flush(): Promise<void>;
  /** Flushes and stops storing updates; rejects as flush does. */
  close(): Promise<void>;
}


// Bytes that fail to decode make the caller log the held state as unreadable instead of dropping it silently.
const heldBytes = (value: string): Uint8Array => isCanonicalBase64(value) ? base64ToBytes(value) : new Uint8Array();

function cursorsOf(cursors: StoredMap<number>, held: StoredMap<string>, relayUrl: string): RelayCursorStore {
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
  const known = await StoredMap.load({ storage, name: "known", label: "known file hashes", isValue: isString, logger });
  const bases = await StoredMap.load({ storage, name: "bases", label: "file merge bases", isValue: isString, logger });
  const versions = await loadVersionHistory(storage, logger);
  const cursors = await StoredMap.load({
    storage, name: "relay-cursors", label: "relay cursors", isValue: isCount, logger, maySave: allDocsStored,
  });
  // The held state describes the relay, not this device's docs, so it saves without waiting for doc updates.
  const held = await StoredMap.load({ storage, name: "relay-held", label: "relay held states", isValue: isString, logger });

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
