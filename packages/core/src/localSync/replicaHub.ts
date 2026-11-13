// Keeps one in-memory Y.Doc per open file in step across the pages of one browser: a refcounted replica per key, synced with y-protocols sync messages over a channel port and seeded from the disk text when no peer holds it.
import * as Y from "yjs";
import { systemScheduler, type SessionScheduler } from "../collab/channel.js";
import { readFileText, setFileText } from "../collab/sharedFiles.js";
import { isItemFileName } from "../library/conflicts/mergeBase.js";
import { readQmdDocText, setQmdDocText } from "../qmd/sharedQmdDoc.js";

// CONTRACT: documents/contracts/local-sync.md#replicas
export type ReplicaKind = "text" | "qmd";

/** A qmd item file binds item by item, every other file is one text. */
export function deriveReplicaKind(path: string): ReplicaKind {
  return isItemFileName(path) ? "qmd" : "text";
}

// CONTRACT: documents/contracts/local-sync.md#channel-and-messages
export function replicaChannelName(libraryId: string): string {
  return `labshelf:files:${libraryId}`;
}

/** One sync message for one file key; `to` addresses a single page, otherwise every page reads it. */
export interface ReplicaMessage { readonly key: string; readonly from: string; readonly to?: string; readonly bytes: Uint8Array }

export interface ReplicaChannel { post(message: ReplicaMessage): void; onMessage(listener: (message: ReplicaMessage) => void): () => void }

export interface Replica { readonly key: string; readonly kind: ReplicaKind; readonly doc: Y.Doc; readonly ready: Promise<"peer" | "disk">; text(): string; replace(text: string, origin?: unknown): void; release(): void }

export interface ReplicaHub { open(key: string, kind: ReplicaKind, readDisk: () => Promise<string>): Replica; close(): void }

const DEFAULT_PEER_WAIT_MS = 200;

// ---- Wire: the y-protocols sync layout (tag, then a var-length byte array)

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

// PLATFORM: lib0 (the encoder y-protocols' writeSyncStep1/readSyncMessage take) is not a direct dependency of core, so the frame is written here byte for byte.
function writeVarUint(out: number[], value: number): void {
  let rest = value;
  while (rest > 127) { out.push(128 | (rest & 127)); rest = Math.floor(rest / 128); }
  out.push(rest);
}

function encodeSyncMessage(tag: number, payload: Uint8Array): Uint8Array {
  const head: number[] = [tag];
  writeVarUint(head, payload.length);
  const bytes = new Uint8Array(head.length + payload.length);
  bytes.set(head, 0);
  bytes.set(payload, head.length);
  return bytes;
}

/** @returns the tag and payload, or undefined for a malformed message */
function decodeSyncMessage(bytes: Uint8Array): { tag: number; payload: Uint8Array } | undefined {
  let index = 0;
  const readVarUint = (): number | undefined => {
    let value = 0;
    let shift = 1;
    for (;;) {
      const byte = bytes[index++];
      if (byte === undefined) { return undefined; }
      value += (byte & 127) * shift;
      if (byte < 128) { return value; }
      shift *= 128;
    }
  };
  const tag = readVarUint();
  const length = readVarUint();
  if (tag === undefined || length === undefined || index + length > bytes.length) { return undefined; }
  return { tag, payload: bytes.subarray(index, index + length) };
}

// ---- Layout

interface Layout {
  read(doc: Y.Doc): string;
  write(doc: Y.Doc, text: string, origin: unknown): void;
}

const LAYOUTS: Record<ReplicaKind, Layout> = {
  text: { read: (doc) => readFileText(doc).toString(), write: setFileText },
  qmd: { read: readQmdDocText, write: setQmdDocText },
};

/** FNV-1a over the UTF-16 code units, forced non-zero, so two pages seeding the same text pick the same client id. */
function seedClientId(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

// INVARIANT: the seed's structs depend only on the disk text, so two pages seeding the same text merge into one copy.
function seedUpdate(kind: ReplicaKind, text: string): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = seedClientId(text);
  LAYOUTS[kind].write(seed, text, null);
  const update = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  return update;
}

// ---- Hub

interface Held {
  replica: Replica;
  count: number;
  /** Set once ready has resolved; only then does the replica answer a step1. */
  answering: boolean;
  /** The peer wait is running: a step2 resolves "peer". */
  waiting: boolean;
  cancelWait: () => void;
  resolve: (source: "peer" | "disk") => void;
  step1Sent: Set<string>;
  detach: () => void;
}

/** What the hub's functions share: the channel, this page's id, the held replicas and the origins that tell a peer's update from a seed. */
interface HubContext {
  readonly channel: ReplicaChannel;
  readonly scheduler: SessionScheduler;
  readonly pageId: string;
  readonly peerWaitMs: number;
  /** Marks updates applied from peer messages, so they are not posted back. */
  readonly remoteOrigin: symbol;
  readonly seedOrigin: symbol;
  readonly held: Map<string, Held>;
}

function postSync(ctx: HubContext, key: string, tag: number, payload: Uint8Array, to?: string): void {
  const bytes = encodeSyncMessage(tag, payload);
  ctx.channel.post(to === undefined ? { key, from: ctx.pageId, bytes } : { key, from: ctx.pageId, to, bytes });
}

function sendStep1(ctx: HubContext, key: string, entry: Held, to: string): void {
  entry.step1Sent.add(to);
  postSync(ctx, key, SYNC_STEP1, Y.encodeStateVector(entry.replica.doc), to);
}

function receiveMessage(ctx: HubContext, message: ReplicaMessage): void {
  if (message.from === ctx.pageId || (message.to !== undefined && message.to !== ctx.pageId)) { return; }
  const entry = ctx.held.get(message.key);
  if (!entry) { return; }
  const decoded = decodeSyncMessage(message.bytes);
  if (!decoded) { return; }
  const { doc } = entry.replica;
  if (decoded.tag === SYNC_STEP1) {
    // INVARIANT: a replica still waiting answers nothing, so pages opening at once seed from disk instead of syncing empty docs.
    if (!entry.answering) { return; }
    postSync(ctx, message.key, SYNC_STEP2, Y.encodeStateAsUpdate(doc, decoded.payload), message.from);
    if (!entry.step1Sent.has(message.from)) { sendStep1(ctx, message.key, entry, message.from); }
    return;
  }
  if (decoded.tag !== SYNC_STEP2 && decoded.tag !== SYNC_UPDATE) { return; }
  Y.applyUpdate(doc, decoded.payload, ctx.remoteOrigin);
  if (decoded.tag === SYNC_STEP2 && entry.waiting) {
    entry.waiting = false;
    entry.cancelWait();
    entry.answering = true;
    entry.resolve("peer");
  }
}

function dropReplica(ctx: HubContext, key: string, entry: Held): void {
  if (ctx.held.get(key) !== entry) { return; }
  ctx.held.delete(key);
  entry.waiting = false;
  entry.cancelWait();
  entry.detach();
  entry.replica.doc.destroy();
}

/** With no peer answering in time, seeds the replica from the disk text. */
function startPeerWait(ctx: HubContext, key: string, entry: Held, readDisk: () => Promise<string>, reject: (error: unknown) => void): void {
  const { doc, kind } = entry.replica;
  entry.cancelWait = ctx.scheduler.after(ctx.peerWaitMs, () => {
    if (!entry.waiting) { return; }
    entry.waiting = false;
    readDisk().then((text) => {
      if (ctx.held.get(key) === entry) { Y.applyUpdate(doc, seedUpdate(kind, text), ctx.seedOrigin); }
      entry.answering = true;
      entry.resolve("disk");
    }, reject);
  });
}

function createHeld(ctx: HubContext, key: string, kind: ReplicaKind, readDisk: () => Promise<string>): Held {
  const doc = new Y.Doc();
  const layout = LAYOUTS[kind];
  let resolve!: (source: "peer" | "disk") => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<"peer" | "disk">((done, fail) => { resolve = done; reject = fail; });
  const entry: Held = {
    count: 1,
    answering: false,
    waiting: true,
    cancelWait: () => {},
    resolve,
    step1Sent: new Set(),
    detach: () => {},
    replica: {
      key,
      kind,
      doc,
      ready,
      text: () => layout.read(doc),
      replace: (text, origin) => { layout.write(doc, text, origin ?? null); },
      release: () => {
        if (ctx.held.get(key) !== entry) { return; }
        entry.count -= 1;
        if (entry.count <= 0) { dropReplica(ctx, key, entry); }
      },
    },
  };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== ctx.remoteOrigin) { postSync(ctx, key, SYNC_UPDATE, update); }
  };
  doc.on("update", onUpdate);
  entry.detach = () => doc.off("update", onUpdate);
  ctx.held.set(key, entry);
  postSync(ctx, key, SYNC_STEP1, Y.encodeStateVector(doc));
  startPeerWait(ctx, key, entry, readDisk, reject);
  return entry;
}

// CONTRACT: documents/contracts/local-sync.md#replicas
export function createReplicaHub(options: { channel: ReplicaChannel; scheduler?: SessionScheduler; pageId?: string; peerWaitMs?: number }): ReplicaHub {
  const ctx: HubContext = {
    channel: options.channel,
    scheduler: options.scheduler ?? systemScheduler,
    pageId: options.pageId ?? globalThis.crypto.randomUUID(),
    peerWaitMs: options.peerWaitMs ?? DEFAULT_PEER_WAIT_MS,
    remoteOrigin: Symbol("replica-remote"),
    seedOrigin: Symbol("replica-seed"),
    held: new Map(),
  };
  const stopListening = ctx.channel.onMessage((message) => receiveMessage(ctx, message));

  return {
    open(key, kind, readDisk) {
      const entry = ctx.held.get(key);
      if (entry) {
        if (entry.replica.kind !== kind) { throw new Error(`Replica "${key}" is held as ${entry.replica.kind}, not ${kind}`); }
        entry.count += 1;
        return entry.replica;
      }
      return createHeld(ctx, key, kind, readDisk).replica;
    },
    close() {
      for (const [key, entry] of [...ctx.held]) { dropReplica(ctx, key, entry); }
      stopListening();
    },
  };
}
