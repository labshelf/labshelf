/** Defines the bridge protocol between the browser extension and the desktop host: version, limits and messages. */
import type { LocalStat } from "../ports/index.js";

/** The protocol major; both sides refuse any other value. */
export const BRIDGE_PROTOCOL = 1;

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
