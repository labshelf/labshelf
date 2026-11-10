/** Verifies that the mirror runner applies edits first, diffs the selection against the hash table, plans against the
 * storage limit, sends small text in JSON batches and the rest as files, deletes vanished rows, holds the writer lease,
 * stops on a `full` refusal and resets on a new Mirror generation. */
import { deriveTextSha256Hex } from "../../src/hash";
import { createMirrorRunner } from "../../src/remoteLibrary/mirrorRunner";
import { MirrorRefusal, type MirrorEdit, type MirrorPut, type MirrorRelay, type MirrorStatus } from "../../src/remoteLibrary/mirrorRelay";
import type { MirrorFile, MirrorSelection } from "../../src/remoteLibrary/mirrorSelection";
import type { MirrorState, MirrorStateStore } from "../../src/remoteLibrary/mirrorState";

const MIB = 1024 * 1024;

interface FakeRelay extends MirrorRelay {
  log: string[];
  putCalls: { put: MirrorPut[]; remove: string[] }[];
  fileCalls: { path: string; kind: string; hash: string; size: number }[];
  info: MirrorStatus;
  pending: MirrorEdit[];
  fail: (request: number) => Error | undefined;
}

function fakeRelay(init: { held?: boolean; fail?: (request: number) => Error | undefined; status?: Partial<MirrorStatus> } = {}): FakeRelay {
  let requests = 0;
  const failing = (): void => {
    requests += 1;
    const error = relay.fail(requests);
    if (error) { throw error; }
  };
  const relay: FakeRelay = {
    log: [], putCalls: [], fileCalls: [], pending: [],
    fail: init.fail ?? (() => undefined),
    info: { generation: "g1", store: "do", used: 0, limit: 5_000_000_000, includePdfs: false, rows: 0, edits: 0, r2: { bound: false, month: "2026-11", operations: 0 }, ...init.status },
    async putOwner() { relay.log.push("owner"); },
    async lease(action) { relay.log.push(action); return action === "acquire" ? init.held ?? true : true; },
    async putRows(rows, remove) { relay.log.push("rows"); failing(); relay.putCalls.push({ put: rows, remove }); },
    async putFile(path, kind, hash, bytes) { relay.log.push("file"); failing(); relay.fileCalls.push({ path, kind, hash, size: bytes.byteLength }); },
    async status() { relay.log.push("status"); return relay.info; },
    async setSettings() { return relay.info; },
    async edits() { relay.log.push("edits"); return relay.pending; },
    async ackEdits() { relay.log.push("ack"); },
    async readFile() { return new Uint8Array(); },
    async clear() { relay.log.push("clear"); },
  };
  return relay;
}

function memoryStore(initial?: MirrorState): MirrorStateStore & { current: MirrorState | undefined } {
  const store = {
    current: initial,
    async read() { return store.current; },
    async write(state: MirrorState) { store.current = JSON.parse(JSON.stringify(state)); },
    async clear() { store.current = undefined; },
  };
  return store;
}

function file(path: string, content: string | Uint8Array, kind: MirrorFile["kind"] = "source"): MirrorFile {
  return { path, kind, read: async () => content };
}

const noFiles = { readBytes: async () => undefined, writeBytes: async () => undefined, remove: async () => undefined };

function runnerFor(files: () => MirrorFile[], relay: MirrorRelay, state: MirrorStateStore, extra: { cap?: number; skipped?: MirrorSelection["skipped"]; options?: { includePdfs: boolean }[] } = {}) {
  return createMirrorRunner({
    select: async (options) => { extra.options?.push(options); return { files: files(), skipped: extra.skipped ?? [] }; },
    relay, state, files: noFiles,
    ...(extra.cap !== undefined ? { cap: extra.cap } : {}),
  });
}

const allPuts = (relay: FakeRelay) => relay.putCalls.flatMap((c) => c.put);
const allRemoves = (relay: FakeRelay) => relay.putCalls.flatMap((c) => c.remove);
const sentPaths = (relay: FakeRelay) => [...allPuts(relay).map((p) => p.path), ...relay.fileCalls.map((c) => c.path)].sort();

describe("createMirrorRunner", () => {
  it("a first run uploads every small text file in a JSON batch with its kind, hash, size and text", async () => {
    const relay = fakeRelay();
    const files = [file("index/papers.json", "{}", "papers"), file("papers/a/notes.qmd", "hello", "notes"), file("proj/main.tex", "\\x")];
    const result = await runnerFor(() => files, relay, memoryStore()).run();
    expect(result).toMatchObject({ status: "synced", uploaded: 3, deleted: 0 });
    expect(relay.putCalls).toHaveLength(1);
    expect(allPuts(relay).find((p) => p.path === "papers/a/notes.qmd")).toEqual({ path: "papers/a/notes.qmd", kind: "notes", hash: await deriveTextSha256Hex("hello"), size: 5, value: "hello" });
  });

  it("records every uploaded row in the table under the Mirror's generation", async () => {
    const state = memoryStore();
    await runnerFor(() => [file("a.tex", "aaa"), file("b.png", new Uint8Array([1, 2]), "asset")], fakeRelay(), state).run();
    expect(state.current).toEqual({
      version: 2, generation: "g1",
      rows: { "a.tex": { hash: await deriveTextSha256Hex("aaa"), size: 3, kind: "source" }, "b.png": { hash: await deriveTextSha256Hex(new Uint8Array([1, 2])), size: 2, kind: "asset" } },
    });
  });

  it("sends binary rows and text over 1 MiB with PUT file, small text in batches", async () => {
    const relay = fakeRelay();
    const bytes = new Uint8Array([7, 7, 7]);
    const files = [file("a.tex", "small"), file("big.tex", "b".repeat(MIB + 1)), file("p.pdf", bytes, "output")];
    const result = await runnerFor(() => files, relay, memoryStore()).run();
    expect(result.uploaded).toBe(3);
    expect(allPuts(relay).map((p) => p.path)).toEqual(["a.tex"]);
    expect(relay.fileCalls).toEqual([
      { path: "big.tex", kind: "source", hash: await deriveTextSha256Hex("b".repeat(MIB + 1)), size: MIB + 1 },
      { path: "p.pdf", kind: "output", hash: await deriveTextSha256Hex(bytes), size: 3 },
    ]);
  });

  it("JSON batches stay under 8 MiB", async () => {
    const relay = fakeRelay();
    const files = Array.from({ length: 20 }, (_, i) => file(`src/${i}.tex`, String(i % 10).repeat(MIB - 100)));
    await runnerFor(() => files, relay, memoryStore()).run();
    expect(relay.putCalls.length).toBeGreaterThan(2);
    for (const call of relay.putCalls) expect(JSON.stringify({ put: call.put, delete: call.remove }).length).toBeLessThan(8 * MIB);
    expect(allPuts(relay)).toHaveLength(20);
  });

  it("a second run with nothing changed sends nothing", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    const runner = runnerFor(() => [file("a.tex", "aaa"), file("b.png", new Uint8Array([1]), "asset")], relay, state);
    await runner.run();
    relay.putCalls.length = 0;
    relay.fileCalls.length = 0;
    expect(await runner.run()).toMatchObject({ status: "synced", uploaded: 0, deleted: 0 });
    expect(relay.putCalls).toEqual([]);
    expect(relay.fileCalls).toEqual([]);
  });

  it("lists the selection's skipped files in its result", async () => {
    const skipped = [{ path: "decks/big/deck.html", reason: "over 64 MiB" }];
    const result = await runnerFor(() => [file("a.tex", "a")], fakeRelay(), memoryStore(), { skipped }).run();
    expect(result.skipped).toEqual(skipped);
  });

  it("selects with includePdfs from the status", async () => {
    const options: { includePdfs: boolean }[] = [];
    await runnerFor(() => [], fakeRelay({ status: { includePdfs: true } }), memoryStore(), { options }).run();
    expect(options).toEqual([{ includePdfs: true }]);
  });

  it("a changed file is uploaded alone and a removed one is deleted from the relay and the table", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    let files = [file("a.tex", "aaa"), file("b.typ", "bb"), file("c.bib", "c")];
    const runner = runnerFor(() => files, relay, state);
    await runner.run();
    relay.putCalls.length = 0;
    files = [file("a.tex", "aaa"), file("b.typ", "bb changed")];
    const result = await runner.run();
    expect(result).toMatchObject({ uploaded: 1, deleted: 1 });
    expect(allPuts(relay).map((p) => p.path)).toEqual(["b.typ"]);
    expect(allRemoves(relay)).toEqual(["c.bib"]);
    expect(Object.keys(state.current!.rows).sort()).toEqual(["a.tex", "b.typ"]);
  });

  it("past the cap the run answers partial, withholds deletes and the next run uploads the rest", async () => {
    const relay = fakeRelay();
    const state = memoryStore({ version: 2, generation: "g1", rows: { "gone.tex": { hash: "x", size: 1, kind: "source" } } });
    const files = ["a", "b", "c", "d", "e"].map((c) => file(`src/${c}.tex`, `text ${c}`));
    const runner = runnerFor(() => files, relay, state, { cap: 3 });
    expect(await runner.run()).toMatchObject({ status: "partial", uploaded: 3, deleted: 0 });
    expect(await runner.run()).toMatchObject({ status: "synced", uploaded: 2, deleted: 1 });
    expect(sentPaths(relay)).toEqual(["src/a.tex", "src/b.tex", "src/c.tex", "src/d.tex", "src/e.tex"]);
  });

  it("the default cap stops a run at 400 rows", async () => {
    const relay = fakeRelay();
    const files = Array.from({ length: 401 }, (_, i) => file(`src/f${i}.tex`, `t${i}`));
    expect(await runnerFor(() => files, relay, memoryStore()).run()).toMatchObject({ status: "partial", uploaded: 400 });
  });

  it("a relay failure keeps the requests already accepted and does not throw", async () => {
    const relay = fakeRelay({ fail: (n) => (n === 2 ? new Error("relay down") : undefined) });
    const state = memoryStore();
    const files = ["a", "b", "c"].map((c) => file(`src/${c}.png`, new Uint8Array([c.charCodeAt(0)]), "asset"));
    const result = await runnerFor(() => files, relay, state).run();
    expect(result).toMatchObject({ status: "partial", uploaded: 1 });
    expect(Object.keys(state.current!.rows)).toEqual(["src/a.png"]);
  });

  it("leaves out the files whose upload would pass the limit, still deletes, and reports the storage", async () => {
    const relay = fakeRelay({ status: { used: 95, limit: 100 } });
    const state = memoryStore({ version: 2, generation: "g1", rows: { "old.tex": { hash: "x", size: 10, kind: "source" } } });
    const files = [file("a.tex", "1234"), file("b.png", new Uint8Array(5), "asset"), file("c.tex", "1")];
    const result = await runnerFor(() => files, relay, state).run();
    expect(sentPaths(relay)).toEqual(["a.tex", "c.tex"]);
    expect(allRemoves(relay)).toEqual(["old.tex"]);
    expect(result.status).toBe("partial");
    expect(result.storage).toEqual({ store: "do", used: 90, limit: 100, warn: true, full: true, leftOut: ["b.png"] });
  });

  it("counts a changed row's old size when planning", async () => {
    const relay = fakeRelay({ status: { used: 100, limit: 100 } });
    const state = memoryStore({ version: 2, generation: "g1", rows: { "a.tex": { hash: "old", size: 10, kind: "source" } } });
    const result = await runnerFor(() => [file("a.tex", "short")], relay, state).run();
    expect(result.storage).toMatchObject({ used: 95, full: false, leftOut: [], warn: true });
    expect(result.status).toBe("synced");
  });

  it("a full refusal stops the run, leaves the refused file out and withholds deletes", async () => {
    const relay = fakeRelay({ fail: (n) => (n === 2 ? new MirrorRefusal("full", 507, "full", "storage") : undefined) });
    const state = memoryStore({ version: 2, generation: "g1", rows: { "old.tex": { hash: "x", size: 1, kind: "source" } } });
    const files = [file("a.png", new Uint8Array([1]), "asset"), file("b.png", new Uint8Array([2]), "asset"), file("c.png", new Uint8Array([3]), "asset")];
    const result = await runnerFor(() => files, relay, state).run();
    expect(result).toMatchObject({ status: "partial", uploaded: 1, deleted: 0 });
    expect(result.storage).toMatchObject({ full: true, leftOut: ["b.png"] });
    expect(allRemoves(relay)).toEqual([]);
  });

  it("a file refused as too large is skipped and the run goes on", async () => {
    const relay = fakeRelay({ fail: (n) => (n === 1 ? new MirrorRefusal("big", 413, "tooLarge") : undefined) });
    const files = [file("a.png", new Uint8Array([1]), "asset"), file("b.png", new Uint8Array([2]), "asset")];
    const result = await runnerFor(() => files, relay, memoryStore()).run();
    expect(result.skipped.map((s) => s.path)).toEqual(["a.png"]);
    expect(result).toMatchObject({ status: "synced", uploaded: 1 });
  });

  it("when another device holds the lease the run answers skipped and sends nothing", async () => {
    const relay = fakeRelay({ held: false });
    const state = memoryStore();
    const result = await runnerFor(() => [file("a.tex", "a")], relay, state).run();
    expect(result).toEqual({ status: "skipped", uploaded: 0, deleted: 0, skipped: [] });
    expect(relay.log).toEqual(["acquire"]);
    expect(state.current).toBeUndefined();
  });

  it("runs lease, status and edits before any upload and releases after the last", async () => {
    const relay = fakeRelay();
    await runnerFor(() => [file("a.tex", "a")], relay, memoryStore()).run();
    expect(relay.log.slice(0, 3)).toEqual(["acquire", "status", "edits"]);
    expect(relay.log.indexOf("rows")).toBeGreaterThan(2);
    expect(relay.log[relay.log.length - 1]).toBe("release");
    expect(relay.log.filter((e) => e === "release")).toHaveLength(1);
  });

  it("the lease is released after a run that failed against the relay", async () => {
    const relay = fakeRelay({ fail: () => new Error("down") });
    await runnerFor(() => [file("a.tex", "a")], relay, memoryStore()).run();
    expect(relay.log[relay.log.length - 1]).toBe("release");
  });

  it("an edit that cannot be applied holds the uploads", async () => {
    const relay = fakeRelay();
    relay.pending = [{ path: "home.json", base: "", hash: "h", deleted: false, at: 1 }];
    relay.readFile = async () => { throw new Error("down"); };
    const result = await runnerFor(() => [file("home.json", "local", "home")], relay, memoryStore()).run();
    expect(result).toMatchObject({ status: "partial", uploaded: 0, edits: { applied: 0, conflicts: [], failed: 1 } });
    expect(relay.putCalls).toEqual([]);
  });

  it("a new generation empties the table and re-uploads everything without deleting the old rows", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    let files = [file("a.tex", "aaa"), file("gone.typ", "bb")];
    await runnerFor(() => files, relay, state).run();
    relay.putCalls.length = 0;
    relay.info = { ...relay.info, generation: "g2" };
    files = [file("a.tex", "aaa")];
    const result = await runnerFor(() => files, relay, state).run();
    expect(result).toMatchObject({ status: "synced", uploaded: 1, deleted: 0 });
    expect(allRemoves(relay)).toEqual([]);
    expect(state.current?.generation).toBe("g2");
  });
});
