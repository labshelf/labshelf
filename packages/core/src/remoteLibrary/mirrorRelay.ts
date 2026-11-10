/** The client of the relay Worker's owner routes under /mirror/*: the owner email, the writer lease, row batches, single
 * files, the status and settings, the edits made on /open/ and the clear that turning Remote access off sends. Every call
 * carries the owner secret as bearer and rejects with a MirrorRefusal when the Worker refuses. */
import { parseJsonObject } from "../json/index.js";
import type { MirrorKind } from "./mirrorState.js";

/** One row of a `POST /mirror/rows` request: its library-relative path, kind, content hash, byte size and text. */
export interface MirrorPut { path: string; kind: MirrorKind; hash: string; size: number; value: string }
export type MirrorStore = "do" | "r2";
export interface MirrorStatus {
  generation: string; store: MirrorStore; used: number; limit: number; includePdfs: boolean; rows: number; edits: number;
  r2: { bound: boolean; month: string; operations: number };
}
/** A change made on /open/: `base` is the row hash the page edited (`""` for a new file), `hash` the row's hash now (`""` when deleted). */
export interface MirrorEdit { path: string; base: string; hash: string; deleted: boolean; at: number }
export interface MirrorSettings { limit?: number | null; includePdfs?: boolean; store?: MirrorStore }

export interface MirrorRelay {
  putOwner(email: string): Promise<void>;
  lease(action: "acquire" | "renew" | "release"): Promise<boolean>;
  putRows(rows: MirrorPut[], remove: string[]): Promise<void>;
  putFile(path: string, kind: MirrorKind, hash: string, bytes: Uint8Array): Promise<void>;
  status(): Promise<MirrorStatus>;
  setSettings(settings: MirrorSettings): Promise<MirrorStatus>;
  edits(): Promise<MirrorEdit[]>;
  ackEdits(edits: { path: string; hash: string }[]): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  clear(): Promise<void>;
}

/** A refusal of the Worker: `code` is its `error` (`full`, `conflict`, `noBucket`, `tooLarge`, ...; `""` when unreadable), `reason` the `full` cause (`storage` or `operations`). */
export class MirrorRefusal extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly reason?: string) {
    super(message);
    this.name = "MirrorRefusal";
  }
}

async function refusal(response: Response, route: string): Promise<MirrorRefusal> {
  let code = "";
  let reason: string | undefined;
  try {
    const body = parseJsonObject(await response.text());
    if (typeof body?.["error"] === "string") { code = body["error"]; }
    if (typeof body?.["reason"] === "string") { reason = body["reason"]; }
  } catch {
    // An unreadable body only loses the code.
  }
  return new MirrorRefusal(`The relay refused ${route}: ${response.status}${code ? ` (${code})` : ""}`, response.status, code, reason);
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function parseStatus(text: string): MirrorStatus {
  const body = parseJsonObject(text);
  const r2 = body?.["r2"];
  const { generation, store, used, limit, includePdfs, rows, edits } = body ?? {};
  if (typeof generation !== "string" || generation === "" || (store !== "do" && store !== "r2") || !isCount(used) || !isCount(limit)
    || typeof includePdfs !== "boolean" || !isCount(rows) || !isCount(edits) || typeof r2 !== "object" || r2 === null) {
    throw new Error("The relay answered an unreadable Mirror status.");
  }
  const { bound, month, operations } = r2 as Record<string, unknown>;
  if (typeof bound !== "boolean" || typeof month !== "string" || !isCount(operations)) { throw new Error("The relay answered an unreadable Mirror status."); }
  return { generation, store, used, limit, includePdfs, rows, edits, r2: { bound, month, operations } };
}

function parseEdit(value: unknown): MirrorEdit | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const { path, base, hash, deleted, at } = value as Record<string, unknown>;
  if (typeof path !== "string" || typeof base !== "string" || typeof hash !== "string" || !isCount(at)) { return undefined; }
  return { path, base, hash, deleted: deleted === true || deleted === 1, at };
}

/** The route of a library-relative path, each segment URL-encoded. */
const fileRoute = (prefix: string, path: string): string => `${prefix}/${path.split("/").map(encodeURIComponent).join("/")}`;

export function createMirrorRelay(options: { relayUrl: string; ownerSecret: string; deviceId: string; fetch: typeof fetch }): MirrorRelay {
  const base = options.relayUrl.replace(/\/+$/, "");

  async function call(method: string, route: string, body?: unknown, extra?: { headers: Record<string, string>; bytes: Uint8Array }): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${options.ownerSecret}` };
    const init: RequestInit = { method, headers };
    if (extra) {
      Object.assign(headers, extra.headers, { "content-type": "application/octet-stream" });
      init.body = extra.bytes as NonNullable<RequestInit["body"]>;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await options.fetch(`${base}${route}`, init);
    if (!response.ok) { throw await refusal(response, `${method} ${route}`); }
    return response;
  }

  return {
    async putOwner(email) {
      await call("PUT", "/mirror/owner", { email });
    },
    async lease(action) {
      const response = await call("POST", "/mirror/lease", { deviceId: options.deviceId, action });
      return parseJsonObject(await response.text())?.["held"] === true;
    },
    async putRows(rows, remove) {
      await call("POST", "/mirror/rows", { put: rows, delete: remove });
    },
    async putFile(path, kind, hash, bytes) {
      await call("PUT", fileRoute("/mirror/file", path), undefined, { headers: { "x-labshelf-kind": kind, "x-labshelf-hash": hash }, bytes });
    },
    async status() {
      return parseStatus(await (await call("GET", "/mirror/status")).text());
    },
    async setSettings(settings) {
      return parseStatus(await (await call("PUT", "/mirror/settings", settings)).text());
    },
    async edits() {
      const list = parseJsonObject(await (await call("GET", "/mirror/edits")).text())?.["edits"];
      if (!Array.isArray(list)) { throw new Error("The relay answered an unreadable edit list."); }
      return list.map(parseEdit).filter((edit): edit is MirrorEdit => edit !== undefined);
    },
    async ackEdits(edits) {
      await call("POST", "/mirror/edits/ack", { edits });
    },
    async readFile(path) {
      return new Uint8Array(await (await call("GET", fileRoute("/mirror/file", path))).arrayBuffer());
    },
    async clear() {
      await call("DELETE", "/mirror/rows");
    },
  };
}
