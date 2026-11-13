// Holds the owner's remote library as a Durable Object of the share Worker: the mirrored rows with their values (7 MiB SQLite chunks, or one
// R2 object per row), the settings (store, limit, paper PDFs, the R2 operations of the month), the edits made on /open/, the owner email, the
// writer lease and the hourly session counter, in SQLite.
// The Mirror trusts its caller: the owner secret and session checks are made by the relay routes before a request reaches it.

import { isString } from "../../guards/index.js";
import { deriveSha256Hex } from "../../hash/index.js";
import { checkRelativePath } from "../../path/relativePath.js";
import { isMirrorKind, mirrorKindOfPath } from "../../remoteLibrary/mirrorState.js";
import type { MirrorState, R2BucketLike, ShareEnv } from "./cloudflareRuntime.js";
import { DO_LIMIT_BYTES, MirrorRefusal, MirrorStorage, refuseFull, type MirrorWrite } from "./mirrorStorage.js";

// CONTRACT: documents/contracts/remote-library.md
/** R2 Class A operations (put, list) of a UTC month past which puts are refused, under the free 1 million. */
const R2_MONTHLY_OPERATIONS = 900_000;
/** R2 deletes and lists take at most this many keys at once. */
const R2_PAGE = 1000;

/** The paths the relay Worker uses to reach the Mirror; `file` and `edit` take the row's path as the `path` query parameter. */
export const MIRROR_PATH = {
  owner: "/owner", lease: "/lease", rows: "/rows", index: "/index", file: "/file", sessions: "/sessions", status: "/status",
  settings: "/settings", edit: "/edit", edits: "/edits", editsAck: "/edits/ack",
} as const;

/** One row a sync puts in JSON: its library-relative path, its metadata and its whole text value. */
interface MirrorPutRow { path: string; kind: string; hash: string; size: number; value: string }

const r2KeyOf = (generation: string, path: string): string => `${generation}/${path}`;

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

const isPutRow = (value: unknown): value is MirrorPutRow => {
  const row = value as Partial<MirrorPutRow> | null;
  return typeof row === "object" && row !== null && isString(row.path) && isString(row.kind) && isString(row.hash)
    && isMirrorKind(row.kind) && typeof row.size === "number" && isString(row.value);
};

const isRowPath = (path: unknown): path is string => typeof path === "string" && checkRelativePath(path) === undefined;

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return undefined; }
}

/** The `path` query parameter of a file or edit request, refused `malformed` when it is not a safe relative path. */
function pathParam(url: URL): string {
  const path = url.searchParams.get("path");
  if (!isRowPath(path)) { throw new MirrorRefusal("malformed"); }
  return path;
}

export class Mirror {
  private readonly storage: MirrorStorage;
  private readonly bucket: R2BucketLike | undefined;

  constructor(state: MirrorState, env: Pick<ShareEnv, "MIRROR_BUCKET">) {
    this.storage = new MirrorStorage(state.storage.sql, (work) => state.storage.transactionSync(work));
    this.bucket = env.MIRROR_BUCKET;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.answer(request);
    } catch (error) {
      if (error instanceof MirrorRefusal) { return json({ ...error.details, error: error.kind }, error.kind === "notFound" ? 404 : 400); }
      throw error;
    }
  }

  private async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (`${request.method} ${url.pathname}`) {
      case `GET ${MIRROR_PATH.owner}`: return json({ email: this.storage.owner() });
      case `PUT ${MIRROR_PATH.owner}`: {
        const body = (await readJson(request)) as { email?: unknown } | undefined;
        if (!isString(body?.email)) { throw new MirrorRefusal("malformed"); }
        this.storage.setOwner(body.email);
        return json({});
      }
      case `POST ${MIRROR_PATH.lease}`: {
        const body = (await readJson(request)) as { deviceId?: unknown; action?: unknown } | undefined;
        const action = body?.action;
        if (!isString(body?.deviceId) || (action !== "acquire" && action !== "renew" && action !== "release")) { throw new MirrorRefusal("malformed"); }
        return json({ held: this.storage.lease(body.deviceId, action, Date.now()) });
      }
      case `POST ${MIRROR_PATH.sessions}`: {
        const body = (await readJson(request)) as { hour?: unknown; limit?: unknown } | undefined;
        const hour = body?.hour;
        const limit = body?.limit;
        if (!Number.isInteger(hour) || !Number.isInteger(limit)) { throw new MirrorRefusal("malformed"); }
        return json({ allowed: this.storage.countSession(hour as number, limit as number) });
      }
      case `POST ${MIRROR_PATH.rows}`: return this.putRows(request);
      case `DELETE ${MIRROR_PATH.rows}`:
        await this.clearRows();
        this.storage.clearOwner();
        return json({});
      case `GET ${MIRROR_PATH.index}`: return json(this.storage.index());
      case `GET ${MIRROR_PATH.file}`: return this.readFile(pathParam(url));
      case `PUT ${MIRROR_PATH.file}`: return this.putFile(pathParam(url), request);
      case `GET ${MIRROR_PATH.status}`: return json(this.status());
      case `PUT ${MIRROR_PATH.settings}`: return this.putSettings(request);
      case `PUT ${MIRROR_PATH.edit}`: return this.edit(pathParam(url), request, false);
      case `DELETE ${MIRROR_PATH.edit}`: return this.edit(pathParam(url), request, true);
      case `GET ${MIRROR_PATH.edits}`: return json({ edits: this.storage.edits() });
      case `POST ${MIRROR_PATH.editsAck}`: return this.ackEdits(request);
      default: return new Response(null, { status: 404 });
    }
  }

  private async putFile(path: string, request: Request): Promise<Response> {
    const kind = request.headers.get("x-labshelf-kind");
    const hash = request.headers.get("x-labshelf-hash");
    if (!isMirrorKind(kind) || !hash) { throw new MirrorRefusal("malformed"); }
    await this.writeRows([{ path, kind, hash, bytes: new Uint8Array(await request.arrayBuffer()) }]);
    return json({});
  }

  private async ackEdits(request: Request): Promise<Response> {
    const body = (await readJson(request)) as { edits?: unknown } | undefined;
    const acks = body?.edits;
    const isAck = (ack: unknown): ack is { path: string; hash: string } =>
      typeof ack === "object" && ack !== null && isString((ack as { path?: unknown }).path) && isString((ack as { hash?: unknown }).hash);
    if (!Array.isArray(acks) || !acks.every(isAck)) { throw new MirrorRefusal("malformed"); }
    for (const ack of acks) { this.storage.ackEdit(ack.path, ack.hash); }
    return json({});
  }

  private async putRows(request: Request): Promise<Response> {
    const body = (await readJson(request)) as { put?: unknown; delete?: unknown } | undefined;
    const put = body?.put ?? [];
    const remove = body?.delete ?? [];
    if (!Array.isArray(put) || !put.every(isPutRow) || !put.every((row) => isRowPath(row.path)) || !Array.isArray(remove) || !remove.every(isString)) {
      throw new MirrorRefusal("malformed");
    }
    await this.removeRows(remove);
    const encoder = new TextEncoder();
    await this.writeRows(put.map((row) => ({ path: row.path, kind: row.kind, hash: row.hash, bytes: encoder.encode(row.value) })));
    return json({});
  }

  /** The bucket of store `r2`; a Mirror moved to R2 whose binding is gone refuses `noBucket`. */
  private requireBucket(): R2BucketLike {
    if (!this.bucket) { throw new MirrorRefusal("noBucket"); }
    return this.bucket;
  }

  /** Writes rows after checking the whole batch against the limit and, in R2, the month's operations, so a refused batch writes nothing. */
  private async writeRows(writes: MirrorWrite[]): Promise<void> {
    if (writes.length === 0) { return; }
    const now = Date.now();
    const settings = this.storage.settings();
    const sizes = new Map<string, number>();
    for (const write of writes) { sizes.set(write.path, write.bytes.byteLength); }
    let used = this.storage.used();
    for (const [path, size] of sizes) { used += size - this.storage.sizeOf(path); }
    if (used > this.storage.limit(settings)) { throw refuseFull("storage"); }
    if (settings.store === "r2") {
      const bucket = this.requireBucket();
      if (this.storage.operations(now).operations + writes.length > R2_MONTHLY_OPERATIONS) { throw refuseFull("operations"); }
      for (const write of writes) {
        await bucket.put(r2KeyOf(settings.generation, write.path), write.bytes);
        this.storage.countOperations(1, now);
      }
    }
    for (const write of writes) { this.storage.writeRow(write, settings.store, now); }
  }

  private async removeRows(paths: string[]): Promise<void> {
    const { store, generation } = this.storage.settings();
    const present = paths.filter((path) => this.storage.row(path) !== undefined);
    if (store === "r2" && this.bucket) {
      for (let at = 0; at < present.length; at += R2_PAGE) {
        await this.bucket.delete(present.slice(at, at + R2_PAGE).map((path) => r2KeyOf(generation, path)));
      }
    }
    for (const path of paths) { this.storage.removeRow(path); }
  }

  private async readFile(path: string): Promise<Response> {
    const row = this.storage.row(path);
    if (!row) { throw new MirrorRefusal("notFound"); }
    const { store, generation } = this.storage.settings();
    const headers = { "Content-Type": "application/octet-stream" };
    if (store === "do") { return new Response(this.storage.readChunks(path, row.size).buffer as ArrayBuffer, { status: 200, headers }); }
    const object = await this.requireBucket().get(r2KeyOf(generation, path));
    if (!object) { throw new MirrorRefusal("notFound"); }
    return new Response(object.body, { status: 200, headers });
  }

  /** Clears every row, chunk and edit, deletes the R2 objects of the generation, and draws a new generation; the owner stays. */
  private async clearRows(): Promise<void> {
    const { store, generation } = this.storage.settings();
    if (store === "r2" && this.bucket) {
      const now = Date.now();
      let cursor: string | undefined;
      do {
        const page = await this.bucket.list({ prefix: `${generation}/`, limit: R2_PAGE, ...(cursor === undefined ? {} : { cursor }) });
        this.storage.countOperations(1, now);
        if (page.objects.length > 0) { await this.bucket.delete(page.objects.map((object) => object.key)); }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor !== undefined);
    }
    this.storage.clearRows();
  }

  private status(): Record<string, unknown> {
    const settings = this.storage.settings();
    const { month, operations } = this.storage.operations(Date.now());
    return {
      generation: settings.generation, store: settings.store, used: this.storage.used(), limit: this.storage.limit(settings),
      includePdfs: settings.includePdfs, rows: this.storage.count("rows"), edits: this.storage.count("edits"),
      r2: { bound: this.bucket !== undefined, month, operations },
    };
  }

  private async putSettings(request: Request): Promise<Response> {
    const body = (await readJson(request)) as { limit?: unknown; includePdfs?: unknown; store?: unknown } | undefined;
    if (typeof body !== "object" || body === null) { throw new MirrorRefusal("malformed"); }
    const { limit, includePdfs, store } = body;
    const isLimit = limit === undefined || limit === null || (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0);
    if (!isLimit || (includePdfs !== undefined && typeof includePdfs !== "boolean")
      || (store !== undefined && store !== "do" && store !== "r2")) { throw new MirrorRefusal("malformed"); }
    const current = this.storage.settings();
    const nextStore = store ?? current.store;
    const nextLimit = limit === undefined ? current.limitBytes : limit;
    if (nextStore === "do" && nextLimit !== null && nextLimit > DO_LIMIT_BYTES) { throw new MirrorRefusal("malformed"); }
    if (nextStore === "r2" && !this.bucket) { throw new MirrorRefusal("noBucket"); }
    if (nextStore !== current.store) { await this.clearRows(); }
    this.storage.writeSettings({
      ...this.storage.settings(), store: nextStore, limitBytes: nextLimit, includePdfs: includePdfs ?? current.includePdfs,
    });
    return json(this.status());
  }

  /** Applies an edit from /open/ when `x-labshelf-base` still names the row's hash (`""` for no row), and records it for the home folder. */
  private async edit(path: string, request: Request, deleted: boolean): Promise<Response> {
    const base = request.headers.get("x-labshelf-base");
    if (base === null) { throw new MirrorRefusal("malformed"); }
    const row = this.storage.row(path);
    const current = row?.hash ?? "";
    if (base !== current) { throw new MirrorRefusal("conflict", { hash: current }); }
    const now = Date.now();
    if (deleted) {
      if (!row) { return json({}); }
      await this.removeRows([path]);
      this.storage.recordEdit(path, base, "", true, now);
      return json({});
    }
    const kind = row?.kind ?? mirrorKindOfPath(path);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const hash = await deriveSha256Hex(bytes);
    await this.writeRows([{ path, kind, hash, bytes }]);
    this.storage.recordEdit(path, base, hash, false, now);
    return json({ hash });
  }
}
