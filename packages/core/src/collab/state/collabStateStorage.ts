// Declares the port a device implements to keep a share's collaboration state: doc states, update logs, maps and blobs.
// CONTRACT: documents/contracts/collaboration.md#device-local-state

/** What is stored of one doc: its last compacted state and the updates appended since, in append order. */
export interface StoredDoc {
  snapshot?: Uint8Array;
  updates: Uint8Array[];
  /** An interrupted append left a partial record after `updates`; it is not part of them. */
  torn: boolean;
}

export type StateMapName = "known" | "relay-cursors";

export interface CollabStateStorage {
  /** The id a doc is stored under; synchronous because a share session creates docs synchronously. */
  docId(docKey: string): string;
  /** Every stored doc by doc id. */
  loadDocs(): Promise<Map<string, StoredDoc>>;
  /** Replaces the doc's stored state with `state` and no updates; a crash leaves either the old or the new state. */
  compactDoc(docId: string, state: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  /** The map as last saved, undefined when none is; rejects on unreadable data. */
  loadMap(name: StateMapName): Promise<unknown>;
  /** Replaces the map whole; a crash leaves either the old or the new map. */
  saveMap(name: StateMapName, entries: Record<string, unknown>): Promise<void>;
  /** `hash` is always a lowercase SHA-256 hex, so it is safe as a key or a file name. */
  readBlob(hash: string): Promise<Uint8Array | undefined>;
  writeBlob(hash: string, bytes: Uint8Array): Promise<void>;
}
