/** Verifies that the edits made on /open/ reach the library: applied at their base, left alone when already there, written
 * as a conflict copy otherwise, recorded in the device table and acked; and that the standalone pull takes the lease. */
import { deriveTextSha256Hex } from "../../src/hash";
import { parseConflictName } from "../../src/library/conflicts";
import { applyMirrorEdits, type MirrorEditsDeps } from "../../src/remoteLibrary/mirrorEdits";
import type { MirrorEdit } from "../../src/remoteLibrary/mirrorRelay";
import type { MirrorState } from "../../src/remoteLibrary/mirrorState";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const hashOf = (value: string): Promise<string> => deriveTextSha256Hex(value);

function world(init: { edits: MirrorEdit[]; local?: Record<string, string>; web?: Record<string, string>; state?: MirrorState; held?: boolean }) {
  const local = new Map(Object.entries(init.local ?? {}).map(([path, value]) => [path, text(value)]));
  const log: string[] = [];
  const acked: { path: string; hash: string }[] = [];
  const store = { current: init.state };
  const deps: MirrorEditsDeps = {
    relay: {
      edits: async () => { log.push("edits"); return init.edits; },
      readFile: async (path) => { log.push(`read ${path}`); return text(init.web?.[path] ?? ""); },
      ackEdits: async (edits) => { log.push("ack"); acked.push(...edits); },
      lease: async (action) => { log.push(action); return init.held ?? true; },
      status: async () => { log.push("status"); return { generation: "g1", store: "do", used: 0, limit: 1, includePdfs: false, rows: 0, edits: 0, r2: { bound: false, month: "", operations: 0 } }; },
    },
    files: {
      readBytes: async (path) => local.get(path),
      writeBytes: async (path, bytes) => { local.set(path, bytes); },
      remove: async (path) => { local.delete(path); },
    },
    state: {
      read: async () => store.current,
      write: async (state) => { store.current = JSON.parse(JSON.stringify(state)); },
      clear: async () => { store.current = undefined; },
    },
  };
  const localText = (path: string): string | undefined => { const bytes = local.get(path); return bytes && new TextDecoder().decode(bytes); };
  return { deps, local, localText, log, acked, store };
}

describe("applyMirrorEdits", () => {
  it("writes the web version over a local file still at the edit's base, records the row and acks", async () => {
    const edit = { path: "papers/a/notes.qmd", base: await hashOf("old"), hash: await hashOf("new"), deleted: false, at: 1 };
    const w = world({ edits: [edit], local: { "papers/a/notes.qmd": "old" }, web: { "papers/a/notes.qmd": "new" } });
    const result = await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(result).toEqual({ applied: 1, conflicts: [], failed: 0 });
    expect(w.localText("papers/a/notes.qmd")).toBe("new");
    expect(w.store.current).toEqual({ version: 2, generation: "g1", rows: { "papers/a/notes.qmd": { hash: edit.hash, size: 3, kind: "notes" } } });
    expect(w.acked).toEqual([{ path: edit.path, hash: edit.hash }]);
  });

  it("creates a new file when the base is empty and the file is missing, keeping a known row kind", async () => {
    const edit = { path: "spaces/s/notes/n.qmd", base: "", hash: await hashOf("hi"), deleted: false, at: 1 };
    const state: MirrorState = { version: 2, generation: "g1", rows: {} };
    const w = world({ edits: [edit], web: { "spaces/s/notes/n.qmd": "hi" }, state });
    await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(w.localText("spaces/s/notes/n.qmd")).toBe("hi");
    expect(w.store.current!.rows["spaces/s/notes/n.qmd"]?.kind).toBe("space");
  });

  it("does not fetch or write when the local file already holds the web version", async () => {
    const edit = { path: "home.json", base: await hashOf("a"), hash: await hashOf("b"), deleted: false, at: 1 };
    const w = world({ edits: [edit], local: { "home.json": "b" } });
    const result = await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(result.applied).toBe(1);
    expect(w.log.some((entry) => entry.startsWith("read"))).toBe(false);
    expect(w.store.current!.rows["home.json"]).toEqual({ hash: edit.hash, size: 1, kind: "home" });
    expect(w.acked).toHaveLength(1);
  });

  it("keeps a changed local file and writes the web version beside it as an app conflict copy", async () => {
    const edit = { path: "projects/t/main.tex", base: await hashOf("base"), hash: await hashOf("web"), deleted: false, at: 1 };
    const w = world({ edits: [edit], local: { "projects/t/main.tex": "mine" }, web: { "projects/t/main.tex": "web" } });
    const result = await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    const copy = result.conflicts[0]!;
    expect(parseConflictName(copy.split("/").pop()!)).toEqual({ original: "main.tex", tool: "app" });
    expect(w.localText(copy)).toBe("web");
    expect(w.localText("projects/t/main.tex")).toBe("mine");
    // The table holds the web hash, so the next diff re-uploads the local file.
    expect(w.store.current!.rows["projects/t/main.tex"]?.hash).toBe(edit.hash);
    expect(w.acked).toHaveLength(1);
  });

  it("deletes a local file at the base for a deleted edit and drops its row", async () => {
    const edit = { path: "spaces/s/notes/n.qmd", base: await hashOf("x"), hash: "", deleted: true, at: 1 };
    const state: MirrorState = { version: 2, generation: "g1", rows: { "spaces/s/notes/n.qmd": { hash: edit.base, size: 1, kind: "space" } } };
    const w = world({ edits: [edit], local: { "spaces/s/notes/n.qmd": "x" }, state });
    await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(w.local.has("spaces/s/notes/n.qmd")).toBe(false);
    expect(w.store.current!.rows).toEqual({});
  });

  it("keeps a changed local file for a deleted edit, so the next sync uploads it again", async () => {
    const edit = { path: "spaces/s/notes/n.qmd", base: await hashOf("x"), hash: "", deleted: true, at: 1 };
    const w = world({ edits: [edit], local: { "spaces/s/notes/n.qmd": "changed" } });
    await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(w.localText("spaces/s/notes/n.qmd")).toBe("changed");
    expect(w.store.current!.rows["spaces/s/notes/n.qmd"]).toBeUndefined();
  });

  it("leaves an edit unacked when the Mirror's bytes no longer match its hash", async () => {
    const edit = { path: "papers/a/notes.qmd", base: "", hash: await hashOf("new"), deleted: false, at: 1 };
    const w = world({ edits: [edit], web: { "papers/a/notes.qmd": "newer" } });
    const result = await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(result).toEqual({ applied: 0, conflicts: [], failed: 0 });
    expect(w.local.size).toBe(0);
    expect(w.acked).toEqual([]);
  });

  it("drops an edit outside the editable areas or with a .. segment without touching files", async () => {
    const edits = [
      { path: "../outside.txt", base: "", hash: "h", deleted: false, at: 1 },
      { path: "projects/../../x", base: "", hash: "h", deleted: false, at: 1 },
      { path: "index/papers.json", base: "", hash: "h", deleted: false, at: 1 },
    ];
    const w = world({ edits });
    const result = await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(result.failed).toBe(3);
    expect(w.local.size).toBe(0);
    expect(w.acked).toHaveLength(3);
  });

  it("counts a failing edit and goes on with the next, leaving it unacked", async () => {
    const bad = { path: "papers/a/notes.qmd", base: "", hash: await hashOf("x"), deleted: false, at: 1 };
    const good = { path: "papers/b/notes.qmd", base: "", hash: await hashOf("y"), deleted: false, at: 2 };
    const w = world({ edits: [bad, good], web: { "papers/a/notes.qmd": "x", "papers/b/notes.qmd": "y" } });
    const write = w.deps.files.writeBytes;
    w.deps.files.writeBytes = async (path, bytes) => { if (path === bad.path) throw new Error("disk"); await write(path, bytes); };
    const result = await applyMirrorEdits({ ...w.deps, generation: "g1" });
    expect(result).toEqual({ applied: 1, conflicts: [], failed: 1 });
    expect(w.acked).toEqual([{ path: good.path, hash: good.hash }]);
  });

  it("standalone, an empty list costs one request and takes no lease", async () => {
    const w = world({ edits: [] });
    expect(await applyMirrorEdits(w.deps)).toEqual({ applied: 0, conflicts: [], failed: 0 });
    expect(w.log).toEqual(["edits"]);
  });

  it("standalone, waiting edits are applied under the lease with the status generation", async () => {
    const edit = { path: "home.json", base: "", hash: await hashOf("h"), deleted: false, at: 1 };
    const w = world({ edits: [edit], web: { "home.json": "h" } });
    await applyMirrorEdits(w.deps);
    expect(w.log[0]).toBe("edits");
    expect(w.log[1]).toBe("acquire");
    expect(w.log).toContain("status");
    expect(w.log[w.log.length - 1]).toBe("release");
    expect(w.store.current!.generation).toBe("g1");
  });

  it("standalone, nothing is applied while another device holds the lease", async () => {
    const edit = { path: "home.json", base: "", hash: await hashOf("h"), deleted: false, at: 1 };
    const w = world({ edits: [edit], web: { "home.json": "h" }, held: false });
    expect(await applyMirrorEdits(w.deps)).toEqual({ applied: 0, conflicts: [], failed: 0 });
    expect(w.local.size).toBe(0);
  });
});
