/** Verifies that the mirror runner diffs the selection against the hash table, uploads changed rows in small batches, deletes vanished ones, holds the writer lease and resets on a relay change. */
import { createMirrorRunner } from "../../src/remoteLibrary/mirrorRunner";
import type { MirrorRelay } from "../../src/remoteLibrary/mirrorRelay";
import type { MirrorFile, MirrorSelection } from "../../src/remoteLibrary/mirrorSelection";
import type { MirrorState, MirrorStateStore } from "../../src/remoteLibrary/mirrorState";

const MIB = 1024 * 1024;

type Put = { path: string; kind: MirrorFile["kind"]; hash: string; size: number; value: string };
type Rows = Parameters<MirrorRelay["putRows"]>[0];

interface FakeRelay extends MirrorRelay {
  log: string[];
  putCalls: { put: Put[]; remove: string[] }[];
  held: boolean;
  failOnPutCall?: number;
}

function fakeRelay(init: { held?: boolean; failOnPutCall?: number } = {}): FakeRelay {
  const relay: FakeRelay = {
    log: [],
    putCalls: [],
    held: init.held ?? true,
    failOnPutCall: init.failOnPutCall,
    async putOwner() { relay.log.push("owner"); },
    async lease(action) {
      relay.log.push(action);
      if (action === "acquire") return relay.held;
      return true;
    },
    async putRows(rows: Rows, remove: string[]) {
      relay.log.push("rows");
      if (relay.failOnPutCall !== undefined && relay.putCalls.length + 1 === relay.failOnPutCall) {
        relay.putCalls.push({ put: [], remove: [] });
        throw new Error("relay down");
      }
      relay.putCalls.push({ put: rows as Put[], remove });
    },
    async clear() { relay.log.push("clear"); },
  };
  return relay;
}

function memoryStore(initial?: MirrorState): MirrorStateStore & { current: MirrorState | undefined; writes: number } {
  const store = {
    current: initial,
    writes: 0,
    async read() { return store.current; },
    async write(state: MirrorState) { store.writes += 1; store.current = JSON.parse(JSON.stringify(state)); },
    async clear() { store.current = undefined; },
  };
  return store;
}

function file(path: string, text: string, kind: MirrorFile["kind"] = "source"): MirrorFile {
  return { path, kind, read: async () => text };
}

const fakeHash = async (text: string) => `h:${text.length}:${text.slice(0, 12)}`;

function runnerFor(files: () => MirrorFile[], relay: MirrorRelay, state: MirrorStateStore, extra: { relayUrl?: string; cap?: number; skipped?: MirrorSelection["skipped"] } = {}) {
  return createMirrorRunner({
    select: async () => ({ files: files(), skipped: extra.skipped ?? [] }),
    relay,
    state,
    relayUrl: extra.relayUrl ?? "https://relay.example",
    hash: fakeHash,
    cap: extra.cap,
  });
}

const allPuts = (relay: FakeRelay) => relay.putCalls.flatMap((c) => c.put);
const allRemoves = (relay: FakeRelay) => relay.putCalls.flatMap((c) => c.remove);
const paths = (puts: Put[]) => puts.map((p) => p.path).sort();

describe("createMirrorRunner", () => {
  it("3.3a a first run uploads every selected file with its kind, hash, size and text", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    const files = [file("index/papers.json", "{}", "papers"), file("papers/a/notes.qmd", "hello", "notes"), file("proj/main.tex", "\\x", "source")];
    const result = await runnerFor(() => files, relay, state).run();
    expect(result.status).toBe("synced");
    expect(result.uploaded).toBe(3);
    expect(result.deleted).toBe(0);
    const puts = allPuts(relay);
    expect(paths(puts)).toEqual(["index/papers.json", "papers/a/notes.qmd", "proj/main.tex"]);
    const notes = puts.find((p) => p.path === "papers/a/notes.qmd")!;
    expect(notes).toEqual({ path: "papers/a/notes.qmd", kind: "notes", hash: await fakeHash("hello"), size: 5, value: "hello" });
  });

  it("3.3a a first run records every uploaded row in the hash table for the relay URL", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    await runnerFor(() => [file("a.tex", "aaa"), file("b.typ", "bb")], relay, state).run();
    expect(state.current?.version).toBe(1);
    expect(state.current?.relayUrl).toBe("https://relay.example");
    expect(state.current?.rows).toEqual({
      "a.tex": { hash: await fakeHash("aaa"), size: 3, kind: "source" },
      "b.typ": { hash: await fakeHash("bb"), size: 2, kind: "source" },
    });
  });

  it("3.3a a second run with nothing changed sends no put and no delete", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    const files = [file("a.tex", "aaa"), file("b.typ", "bb")];
    const runner = runnerFor(() => files, relay, state);
    await runner.run();
    relay.putCalls.length = 0;
    const second = await runner.run();
    expect(second.status).toBe("synced");
    expect(second.uploaded).toBe(0);
    expect(second.deleted).toBe(0);
    expect(allPuts(relay)).toEqual([]);
    expect(allRemoves(relay)).toEqual([]);
  });

  it("3.3a the run lists the selection's skipped files in its result", async () => {
    const relay = fakeRelay();
    const skipped = [{ path: "decks/big/deck.html", reason: "over 20 MiB" }];
    const result = await runnerFor(() => [file("a.tex", "a")], relay, memoryStore(), { skipped }).run();
    expect(result.skipped).toEqual(skipped);
    expect(result.uploaded).toBe(1);
  });

  it("3.3b a changed file is uploaded alone", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    let bText = "bb";
    const runner = runnerFor(() => [file("a.tex", "aaa"), file("b.typ", bText), file("c.bib", "c")], relay, state);
    await runner.run();
    relay.putCalls.length = 0;
    bText = "bb changed";
    const result = await runner.run();
    expect(result.uploaded).toBe(1);
    expect(result.deleted).toBe(0);
    const puts = allPuts(relay);
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe("b.typ");
    expect(puts[0].value).toBe("bb changed");
    expect(state.current?.rows["b.typ"].hash).toBe(await fakeHash("bb changed"));
  });

  it("3.3b a removed file is deleted from the relay and from the hash table", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    let files = [file("a.tex", "aaa"), file("b.typ", "bb")];
    const runner = runnerFor(() => files, relay, state);
    await runner.run();
    relay.putCalls.length = 0;
    files = [file("a.tex", "aaa")];
    const result = await runner.run();
    expect(result.deleted).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(allRemoves(relay)).toEqual(["b.typ"]);
    expect(allPuts(relay)).toEqual([]);
    expect(Object.keys(state.current!.rows)).toEqual(["a.tex"]);
  });

  it("3.3c rows go in requests whose body stays under 1 MiB", async () => {
    const relay = fakeRelay();
    const big = (c: string) => c.repeat(400 * 1024);
    const files = ["a", "b", "c", "d", "e"].map((c) => file(`src/${c}.tex`, big(c)));
    const result = await runnerFor(() => files, relay, memoryStore(), { cap: 1000 }).run();
    expect(result.status).toBe("synced");
    expect(result.uploaded).toBe(5);
    expect(relay.putCalls.length).toBeGreaterThan(1);
    for (const call of relay.putCalls) {
      expect(JSON.stringify({ put: call.put, delete: call.remove }).length).toBeLessThan(MIB);
    }
    expect(paths(allPuts(relay))).toEqual(["src/a.tex", "src/b.tex", "src/c.tex", "src/d.tex", "src/e.tex"]);
  });

  it("3.3c past the cap the run answers partial and the next run uploads the rest", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    const files = ["a", "b", "c", "d", "e"].map((c) => file(`src/${c}.tex`, `text ${c}`));
    const runner = runnerFor(() => files, relay, state, { cap: 3 });
    const first = await runner.run();
    expect(first.status).toBe("partial");
    expect(first.uploaded).toBe(3);
    expect(Object.keys(state.current!.rows)).toHaveLength(3);
    const second = await runner.run();
    expect(second.status).toBe("synced");
    expect(second.uploaded).toBe(2);
    expect(paths(allPuts(relay))).toEqual(["src/a.tex", "src/b.tex", "src/c.tex", "src/d.tex", "src/e.tex"]);
    expect(Object.keys(state.current!.rows)).toHaveLength(5);
  });

  it("3.3c the default cap stops a run at 400 rows", async () => {
    const relay = fakeRelay();
    const files = Array.from({ length: 401 }, (_, i) => file(`src/f${i}.tex`, `t${i}`));
    const result = await runnerFor(() => files, relay, memoryStore()).run();
    expect(result.status).toBe("partial");
    expect(result.uploaded).toBe(400);
    expect(allPuts(relay)).toHaveLength(400);
  });

  it("3.3c a relay failure keeps the batches already accepted and does not throw", async () => {
    const relay = fakeRelay({ failOnPutCall: 2 });
    const state = memoryStore();
    const files = ["a", "b", "c"].map((c) => file(`src/${c}.tex`, c.repeat(600 * 1024)));
    const result = await runnerFor(() => files, relay, state, { cap: 1000 }).run();
    expect(result.status).toBe("partial");
    const accepted = relay.putCalls.slice(0, 1).flatMap((c) => c.put);
    expect(accepted.length).toBeGreaterThan(0);
    expect(Object.keys(state.current?.rows ?? {}).sort()).toEqual(paths(accepted));
    expect(result.uploaded).toBe(accepted.length);
  });

  it("3.3d when another device holds the lease the run answers skipped and makes no put", async () => {
    const relay = fakeRelay({ held: false });
    const state = memoryStore();
    const result = await runnerFor(() => [file("a.tex", "a")], relay, state).run();
    expect(result.status).toBe("skipped");
    expect(result.uploaded).toBe(0);
    expect(result.deleted).toBe(0);
    expect(relay.putCalls).toEqual([]);
    expect(state.current).toBeUndefined();
  });

  it("3.3d the run acquires the lease before any put and releases it after the last one", async () => {
    const relay = fakeRelay();
    await runnerFor(() => [file("a.tex", "a")], relay, memoryStore()).run();
    expect(relay.log[0]).toBe("acquire");
    expect(relay.log[relay.log.length - 1]).toBe("release");
    expect(relay.log.indexOf("rows")).toBeGreaterThan(relay.log.indexOf("acquire"));
    expect(relay.log.filter((e) => e === "release")).toHaveLength(1);
  });

  it("3.3d the lease is released after a run with nothing to send", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    const runner = runnerFor(() => [file("a.tex", "a")], relay, state);
    await runner.run();
    relay.log.length = 0;
    await runner.run();
    expect(relay.log[0]).toBe("acquire");
    expect(relay.log[relay.log.length - 1]).toBe("release");
  });

  it("3.3d the lease is released after a run that failed against the relay", async () => {
    const relay = fakeRelay({ failOnPutCall: 1 });
    await runnerFor(() => [file("a.tex", "a")], relay, memoryStore()).run();
    expect(relay.log[relay.log.length - 1]).toBe("release");
  });

  it("3.3e a changed relay URL empties the table and re-uploads everything", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    const files = [file("a.tex", "aaa"), file("b.typ", "bb")];
    await runnerFor(() => files, relay, state, { relayUrl: "https://old.example" }).run();
    relay.putCalls.length = 0;
    const result = await runnerFor(() => files, relay, state, { relayUrl: "https://new.example" }).run();
    expect(result.status).toBe("synced");
    expect(result.uploaded).toBe(2);
    expect(paths(allPuts(relay))).toEqual(["a.tex", "b.typ"]);
    expect(state.current?.relayUrl).toBe("https://new.example");
  });

  it("3.3e a changed relay URL does not delete the rows the old table held", async () => {
    const relay = fakeRelay();
    const state = memoryStore();
    let files = [file("a.tex", "aaa"), file("gone.typ", "bb")];
    await runnerFor(() => files, relay, state, { relayUrl: "https://old.example" }).run();
    relay.putCalls.length = 0;
    files = [file("a.tex", "aaa")];
    const result = await runnerFor(() => files, relay, state, { relayUrl: "https://new.example" }).run();
    expect(result.deleted).toBe(0);
    expect(allRemoves(relay)).toEqual([]);
    expect(Object.keys(state.current!.rows)).toEqual(["a.tex"]);
  });
});
