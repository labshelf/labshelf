// What the Mirror tests share: an in-memory Mirror with its helpers, the row builders, and the fake clock.
import { DatabaseSync } from "node:sqlite";
import { Mirror } from "../../../src/relay/worker/mirror";
import { fakeBucket, fakeMirrorState } from "./fakeRoomRuntime";

export const BASE = "https://mirror.test";
export const MIB = 1024 * 1024;
export const MINUTE = 60 * 1000;
export const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

export type Row = { path: string; kind: string; hash: string; size: number; value: string };
export type IndexEntry = { path: string; kind: string; hash: string; size: number; updated: unknown };

export const bytesOf = (text: string) => Buffer.byteLength(text, "utf8");

export const rowOf = (path: string, value: string, kind = "source", hash = `hash-of-${path}-${value.length}`): Row =>
  ({ path, kind, hash, size: bytesOf(value), value });

/** A deterministic text of `length` characters with multi-byte characters mixed in, so a lossy split would show. */
export function bigText(length: number, seed: string): string {
  const unit = `${seed}-é-漢字-0123456789-abcdefghijklmnopqrstuvwxyz\n`;
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

export function setup() {
  const db = new DatabaseSync(":memory:");
  const bucket = fakeBucket();
  const env: { MIRROR_BUCKET?: typeof bucket } = { MIRROR_BUCKET: bucket };
  const boot = () => new Mirror(fakeMirrorState(db), env);
  let mirror = boot();

  const send = (path: string, method: string, body?: unknown) => mirror.fetch(new Request(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }));
  const rows = (put: Row[], del: string[] = []) => send("/rows", "POST", { put, delete: del });
  const index = async (): Promise<IndexEntry[]> => {
    const response = await send("/index", "GET");
    expect(response.status).toBe(200);
    return ((await response.json()) as IndexEntry[]).sort((a, b) => a.path.localeCompare(b.path));
  };
  const file = (path: string) => send(`/file?path=${encodeURIComponent(path)}`, "GET");
  const lease = async (deviceId: string, action: "acquire" | "renew" | "release"): Promise<boolean> => {
    const response = await send("/lease", "POST", { deviceId, action });
    expect(response.status).toBe(200);
    return ((await response.json()) as { held: boolean }).held;
  };
  /** Every stored cell of every table, for checking what the object keeps and how large a single cell is. */
  const cells = (): unknown[] => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return tables.flatMap(({ name }) => (db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])
      .flatMap((row) => Object.values(row)));
  };
  const cellBytes = (cell: unknown): number =>
    typeof cell === "string" ? bytesOf(cell) : cell instanceof Uint8Array ? cell.byteLength : 8;
  return {
    send, rows, index, file, lease, cells, cellBytes, db, bucket, env,
    raw: (path: string, init: RequestInit = {}) => mirror.fetch(new Request(`${BASE}${path}`, init)),
    restart: () => { mirror = boot(); },
    storedBytes: () => cells().reduce<number>((sum, cell) => sum + cellBytes(cell), 0),
    largestCell: () => Math.max(0, ...cells().map(cellBytes)),
  };
}

export const at = (now: number) => jest.setSystemTime(now);

/** Registers the hooks that fake the clock for the tests of the file that calls it. */
export function useFakeClock(): void {
  beforeEach(() => {
    // Only the clock is faked: the object's awaits and the crypto calls keep running for real.
    jest.useFakeTimers({
      now: T0,
      doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
        "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval",
        "setTimeout", "clearTimeout"],
    });
  });
  afterEach(() => jest.useRealTimers());
}
