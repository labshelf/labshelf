/** Defines the bridge protocol between the browser extension and the desktop host: version, limits, messages, framing, file chunks and request validation. */
import { bytesToBase64 } from "../encoding/index.js";
import type { LocalStat } from "../ports/index.js";
import { BridgeError } from "./bridgeError.js";

/** The protocol major; both sides refuse any other value. */
export const BRIDGE_PROTOCOL = 2;

/** The Native Messaging host name; Chrome requires lowercase reverse-DNS. */
export const BRIDGE_HOST_NAME = "app.labshelf.bridge";

// PLATFORM: Chrome and Firefox drop host messages over 1 MB, so file bytes travel in chunks whose base64 stays below it.
export const HOST_MESSAGE_LIMIT = 1024 * 1024;
export const BROWSER_MESSAGE_LIMIT = 64 * 1024 * 1024;
export const BRIDGE_CHUNK_BYTES = 512 * 1024;

export type BridgeErrorCode = "notFound" | "outsideLibrary" | "noLibrary" | "protocol" | "io";

// CONTRACT: documents/contracts/bridge.md#messages
/** Paths are relative to the library root, "/"-separated; "" names the root. */
export type BridgeRequest =
  | { id: number; op: "hello"; protocol: number }
  | { id: number; op: "listDir" | "stat" | "readFile" | "writeFile" | "deleteFile" | "deleteDir" | "ensureDir"; path: string }
  | { id: number; op: "rename"; from: string; to: string }
  /** `root` is an absolute path; only a host that serves no library accepts it. */
  | { id: number; op: "setLibrary"; root: string }
  | { id: number; op: "chunk"; data: string }
  /** `size` is the total byte count the browser sent; the host refuses the commit when the staged bytes differ. */
  | { id: number; op: "commit"; size: number };

export type BridgeOp = BridgeRequest["op"];

export interface HelloResult {
  protocol: number;
  libraryRoot: string;
  paperCount: number;
}

/** The result each op answers with; `chunk` has none because chunks are answered by the `commit`. */
export interface BridgeResults {
  hello: HelloResult;
  setLibrary: Pick<HelloResult, "libraryRoot" | "paperCount">;
  listDir: { names: string[] };
  stat: { stat: LocalStat | null };
  readFile: { done: true; size: number };
  writeFile: never;
  commit: { size: number };
  deleteFile: Record<string, never>;
  deleteDir: Record<string, never>;
  ensureDir: Record<string, never>;
  rename: Record<string, never>;
}

export interface BridgeErrorBody {
  code: BridgeErrorCode;
  message: string;
}

export type BridgeResponse =
  | { id: number; ok: true; result: BridgeResults[keyof BridgeResults] }
  /** `id` is null when the failing message carried no usable id. */
  | { id: number | null; ok: false; error: BridgeErrorBody };

/** One base64 piece of a file the host streams for `readFile`. */
export interface BridgeReadChunk {
  id: number;
  chunk: string;
}

export interface BridgeChangedEvent {
  event: "changed";
  paths: string[];
}

export type HostMessage = BridgeResponse | BridgeReadChunk | BridgeChangedEvent;

// ---- Framing ----

// CONTRACT: documents/contracts/bridge.md#framing
const HEADER_BYTES = 4;

// PLATFORM: Native Messaging uses native byte order; every platform the browsers ship on is little-endian.
const LITTLE_ENDIAN = true;

export function encodeFrame(message: unknown, maxBytes = HOST_MESSAGE_LIMIT): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.length > maxBytes) {
    throw new BridgeError("protocol", `Message of ${body.length} bytes exceeds the ${maxBytes}-byte limit`);
  }
  const frame = new Uint8Array(HEADER_BYTES + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, LITTLE_ENDIAN);
  frame.set(body, HEADER_BYTES);
  return frame;
}

export interface DecodeResult {
  messages: unknown[];
  /** Set by the first bad frame; the decoder returns nothing afterwards because the stream has lost its frame boundaries. */
  error?: BridgeError;
}

/** Collects bytes from a stream and yields each complete message, however the bytes were split. */
export class FrameDecoder {
  /** Received bytes not yet consumed; joined only once a whole header or body is buffered. */
  private parts: Uint8Array[] = [];
  private buffered = 0;
  /** The announced body length once its header is read. */
  private bodyLength: number | undefined;
  private broken = false;
  private readonly text = new TextDecoder("utf-8", { fatal: true });

  constructor(private readonly maxBytes = BROWSER_MESSAGE_LIMIT) {}

  push(bytes: Uint8Array): DecodeResult {
    if (this.broken) return { messages: [] };
    this.parts.push(bytes);
    this.buffered += bytes.length;
    const messages: unknown[] = [];
    try {
      for (;;) {
        if (this.bodyLength === undefined) {
          if (this.buffered < HEADER_BYTES) break;
          this.bodyLength = this.readHeader(this.take(HEADER_BYTES));
        }
        if (this.buffered < this.bodyLength) break;
        const body = this.take(this.bodyLength);
        this.bodyLength = undefined;
        messages.push(this.parse(body));
      }
    } catch (error) {
      this.broken = true;
      this.parts = [];
      this.buffered = 0;
      return { messages, error: error as BridgeError };
    }
    return { messages };
  }

  private readHeader(header: Uint8Array): number {
    const length = new DataView(header.buffer, header.byteOffset, HEADER_BYTES).getUint32(0, LITTLE_ENDIAN);
    if (length > this.maxBytes) {
      throw new BridgeError("protocol", `Frame of ${length} bytes exceeds the ${this.maxBytes}-byte limit`);
    }
    return length;
  }

  /** Removes the first `count` buffered bytes, copying only when they span several parts. */
  private take(count: number): Uint8Array {
    this.buffered -= count;
    const first = this.parts[0];
    if (first && first.length >= count) {
      if (first.length === count) this.parts.shift();
      else this.parts[0] = first.subarray(count);
      return first.subarray(0, count);
    }
    const joined = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const part = this.parts[0] as Uint8Array;
      const used = Math.min(part.length, count - filled);
      joined.set(part.subarray(0, used), filled);
      filled += used;
      if (used === part.length) this.parts.shift();
      else this.parts[0] = part.subarray(used);
    }
    return joined;
  }

  private parse(body: Uint8Array): unknown {
    try {
      return JSON.parse(this.text.decode(body));
    } catch (error) {
      throw new BridgeError("protocol", `Frame is not UTF-8 JSON: ${(error as Error).message}`);
    }
  }
}

// ---- File chunks ----

// CONTRACT: documents/contracts/bridge.md#file-transfer
export function splitFileChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BRIDGE_CHUNK_BYTES) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + BRIDGE_CHUNK_BYTES)));
  }
  return chunks;
}

// ---- Request validation ----

const PATH_OPS = new Set(["listDir", "stat", "readFile", "writeFile", "deleteFile", "deleteDir", "ensureDir"]);

// Runtime-neutral absolute-path check: POSIX root, drive letter or UNC.
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

const refuse = (message: string): never => { throw new BridgeError("protocol", message); };

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : refuse(`Op "${String(value["op"])}" needs a string "${key}"`);
}

/** @returns the request id when the message has a usable one, so a refusal can still name it */
export function parseRequestId(value: unknown): number | null {
  const id = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["id"] : undefined;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

// CONTRACT: documents/contracts/bridge.md#messages
export function parseBridgeRequest(value: unknown): BridgeRequest {
  const id = parseRequestId(value);
  if (id === null) return refuse("Request needs an integer id");
  const message = value as Record<string, unknown>;
  const op = message["op"];
  if (typeof op === "string" && PATH_OPS.has(op)) {
    return { id, op: op as "stat", path: stringField(message, "path") };
  }
  switch (op) {
    case "hello": {
      const protocol = message["protocol"];
      return { id, op, protocol: typeof protocol === "number" ? protocol : refuse("Op \"hello\" needs a number \"protocol\"") };
    }
    case "rename": return { id, op, from: stringField(message, "from"), to: stringField(message, "to") };
    case "setLibrary": {
      const root = stringField(message, "root");
      return { id, op, root: ABSOLUTE_PATH.test(root) ? root : refuse("Op \"setLibrary\" needs an absolute \"root\"") };
    }
    case "chunk": return { id, op, data: stringField(message, "data") };
    case "commit": {
      const size = message["size"];
      const valid = typeof size === "number" && Number.isSafeInteger(size) && size >= 0;
      return { id, op, size: valid ? size : refuse("Op \"commit\" needs a non-negative integer \"size\"") };
    }
    default: return refuse(`Unknown op "${String(op)}"`);
  }
}

// CONTRACT: documents/contracts/bridge.md#versioning
export function assertSameProtocol(remote: unknown): void {
  if (remote === BRIDGE_PROTOCOL) return;
  throw new BridgeError(
    "protocol",
    `This side speaks bridge protocol ${BRIDGE_PROTOCOL}, the other side speaks ${String(remote)}. `
      + "Update LabShelf in the browser and on the desktop to the same release.",
  );
}

// ---- Changed events ----

// CONTRACT: documents/contracts/bridge.md#events
const EMPTY_EVENT_BYTES = JSON.stringify({ event: "changed", paths: [] }).length;

export function createChangedEvents(paths: string[]): BridgeChangedEvent[] {
  const encoder = new TextEncoder();
  const events: BridgeChangedEvent[] = [];
  let batch: string[] = [];
  let bytes = EMPTY_EVENT_BYTES;
  for (const changed of paths) {
    const pathBytes = encoder.encode(JSON.stringify(changed)).length;
    // A path after the first also costs its separating comma.
    if (batch.length > 0 && bytes + 1 + pathBytes > HOST_MESSAGE_LIMIT) {
      events.push({ event: "changed", paths: batch });
      batch = [];
      bytes = EMPTY_EVENT_BYTES;
    }
    bytes += (batch.length > 0 ? 1 : 0) + pathBytes;
    batch.push(changed);
  }
  if (batch.length > 0) events.push({ event: "changed", paths: batch });
  return events;
}
