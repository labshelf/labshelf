// Pins how /open/ takes in the Mirror's newer text: the three-way merge of a refused edit, the rebase of a newer pending write, the base kept per file, and the re-check of watched files.
import { createTextMerge } from "@labshelf/core";
import { diff3Merge } from "node-diff3";

import { createMirrorFileSystem, CONFLICT_NOTICE, type MirrorTextChange } from "../../src/open/mirrorFileSystem";
import type { EditAnswer, RemoteLibraryClient } from "../../src/open/remoteClient";

const textMerge = createTextMerge(diff3Merge);
const PATH = "projects/p/notes.txt";
const ROWS = [{ path: PATH, kind: "source", size: 10, updated: 1 }];

interface Row { text: string; hash: string }
interface Write { path: string; data: string | Uint8Array; base: string }

/** A Mirror holding one text row; `other()` is another host editing it; `known` is the client's kept hashes (index() refreshes them). */
function fakeMirror(initial: string, options: { hold?: boolean } = {}) {
  const row: Row = { text: initial, hash: "h0" };
  const known = new Map([[PATH, "h0"]]);
  const writes: Write[] = [];
  const reads: string[] = [];
  let accepted = 0;
  let others = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let firstSeen: () => void = () => undefined;
  const seenFirst = new Promise<void>((resolve) => { firstSeen = resolve; });
  const client: Pick<RemoteLibraryClient, "index" | "file" | "bytes" | "hashOf" | "write" | "remove"> = {
    index: async () => { known.set(PATH, row.hash); return [{ path: PATH, kind: "source", hash: row.hash, size: row.text.length, updated: 2 }]; },
    file: async () => { reads.push(PATH); return row.text; },
    bytes: async () => new Uint8Array(),
    hashOf: (path) => known.get(path) ?? "",
    write: async (path, data, base) => {
      writes.push({ path, data, base });
      if (options.hold && writes.length === 1) { firstSeen(); await gate; }
      if (base !== row.hash) { return { ok: false, conflict: true, hash: row.hash } satisfies EditAnswer; }
      row.text = String(data);
      row.hash = `w${++accepted}`;
      known.set(path, row.hash);
      return { ok: true, hash: row.hash } satisfies EditAnswer;
    },
    remove: async () => ({ ok: true, hash: "" }),
  };
  const other = (text: string): string => { row.text = text; row.hash = `o${++others}`; return row.hash; };
  return { client, row, writes, reads, other, release, seenFirst };
}

const BASE = "one\ntwo\nthree\nfour\n";

describe("a refused edit merges with the Mirror's row", () => {
  it("6.1a merges a change in another line, sends again with the 409's hash as base and keeps the merged text", async () => {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    const otherHash = mirror.other("one\nTWO\nthree\nfour\n");
    await fs.writeText(PATH, "one\ntwo\nthree\nFOUR\n");
    const merged = "one\nTWO\nthree\nFOUR\n";
    expect(mirror.writes).toHaveLength(2);
    expect(mirror.writes[0]).toEqual({ path: PATH, data: "one\ntwo\nthree\nFOUR\n", base: "h0" });
    expect(mirror.writes[1]).toEqual({ path: PATH, data: merged, base: otherHash });
    expect(mirror.row.text).toBe(merged);
    expect(await fs.readText(PATH)).toBe(merged);
  });

  it("6.1b rejects an overlapping change of the same line with the notice, sends nothing more and keeps the page's text", async () => {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    mirror.other("one\nOTHER\nthree\nfour\n");
    await expect(fs.writeText(PATH, "one\nMINE\nthree\nfour\n")).rejects.toThrow(CONFLICT_NOTICE);
    expect(mirror.writes).toHaveLength(1);
    expect(mirror.row.text).toBe("one\nOTHER\nthree\nfour\n");
    expect(await fs.readText(PATH)).toBe("one\nMINE\nthree\nfour\n");
  });

  it("6.1b keeps the base after a conflict, so a later non-overlapping edit still merges", async () => {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    mirror.other("one\nOTHER\nthree\nfour\n");
    await expect(fs.writeText(PATH, "one\nMINE\nthree\nfour\n")).rejects.toThrow(CONFLICT_NOTICE);
    await expect(fs.writeText(PATH, "one\ntwo\nthree\nFOUR\n")).resolves.toBeUndefined();
    expect(mirror.row.text).toBe("one\nOTHER\nthree\nFOUR\n");
  });

  it("6.1c tells a watcher {previous: the page's text, text: merged} after a clean merge that took in the other edit", async () => {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    const changes: MirrorTextChange[] = [];
    fs.watch(PATH, (change) => { changes.push(change); });
    mirror.other("one\nTWO\nthree\nfour\n");
    await fs.writeText(PATH, "one\ntwo\nthree\nFOUR\n");
    expect(changes).toEqual([{ path: PATH, previous: "one\ntwo\nthree\nFOUR\n", text: "one\nTWO\nthree\nFOUR\n" }]);
  });

  it("6.1c does not stop the other watchers when one throws, and stops telling one that unsubscribed", async () => {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    const heard: MirrorTextChange[] = [];
    const gone: MirrorTextChange[] = [];
    fs.watch(PATH, () => { throw new Error("listener failed"); });
    fs.watch(PATH, (change) => { heard.push(change); });
    fs.watch(PATH, (change) => { gone.push(change); })();
    mirror.other("one\nTWO\nthree\nfour\n");
    await fs.writeText(PATH, "one\ntwo\nthree\nFOUR\n");
    expect(heard).toHaveLength(1);
    expect(gone).toEqual([]);
  });

  it("6.1c rebases a write pending during the merge so its later send holds both edits", async () => {
    const base = "l1\nl2\nl3\nl4\nl5\n";
    const mirror = fakeMirror(base, { hold: true });
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 60_000, textMerge);
    await fs.readText(PATH);
    mirror.other("L1\nl2\nl3\nl4\nl5\n");
    const first = fs.writeText(PATH, "l1\nl2\nl3\nl4\nL5\n");
    const flushing = fs.flush();
    await mirror.seenFirst;
    const second = fs.writeText(PATH, "l1\nl2\nL3\nl4\nL5\n");
    mirror.release();
    await first;
    await fs.flush();
    await Promise.all([second, flushing]);
    const both = "L1\nl2\nL3\nl4\nL5\n";
    expect(mirror.writes.at(-1)?.data).toBe(both);
    expect(mirror.row.text).toBe(both);
    expect(await fs.readText(PATH)).toBe(both);
  });
});

describe("the base the file system holds", () => {
  it("6.1e sends the hash it held when the file was read, not the one client.index() refreshed", async () => {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    mirror.other("one\nTWO\nthree\nfour\n");
    await mirror.client.index();
    expect(mirror.client.hashOf(PATH)).toBe("o1");
    await fs.writeText(PATH, "one\ntwo\nthree\nFOUR\n");
    expect(mirror.writes[0]?.base).toBe("h0");
    expect(mirror.row.text).toBe("one\nTWO\nthree\nFOUR\n");
  });
});

describe("recheck of watched files", () => {
  async function watched(options: { delayMs?: number } = {}) {
    const mirror = fakeMirror(BASE);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, options.delayMs ?? 5, textMerge);
    await fs.readText(PATH);
    const changes: MirrorTextChange[] = [];
    fs.watch(PATH, (change) => { changes.push(change); });
    mirror.reads.length = 0;
    return { mirror, fs, changes };
  }

  it("6.1d reads a newer row, updates readText, tells the watcher and sends the next edit based on the new row hash", async () => {
    const { mirror, fs, changes } = await watched();
    const hash = mirror.other("one\nTWO\nthree\nfour\n");
    await fs.recheck();
    expect(mirror.reads).toHaveLength(1);
    expect(await fs.readText(PATH)).toBe("one\nTWO\nthree\nfour\n");
    expect(changes).toEqual([{ path: PATH, previous: BASE, text: "one\nTWO\nthree\nfour\n" }]);
    await fs.writeText(PATH, "one\nTWO\nthree\nFOUR\n");
    expect(mirror.writes).toHaveLength(1);
    expect(mirror.writes[0]?.base).toBe(hash);
  });

  it("6.1d reads nothing and tells nobody when the index hash is unchanged", async () => {
    const { mirror, fs, changes } = await watched();
    await fs.recheck();
    expect(mirror.reads).toEqual([]);
    expect(changes).toEqual([]);
    expect(await fs.readText(PATH)).toBe(BASE);
  });

  it("6.1d reads nothing for a path with a pending write, and the later send merges", async () => {
    const { mirror, fs, changes } = await watched({ delayMs: 60_000 });
    const writing = fs.writeText(PATH, "one\ntwo\nthree\nFOUR\n");
    mirror.other("one\nTWO\nthree\nfour\n");
    await fs.recheck();
    expect(mirror.reads).toEqual([]);
    expect(changes).toEqual([]);
    expect(await fs.readText(PATH)).toBe("one\ntwo\nthree\nFOUR\n");
    await fs.flush();
    await writing;
    expect(mirror.row.text).toBe("one\nTWO\nthree\nFOUR\n");
  });

  it("6.1d changes nothing when the watched path is missing from the index", async () => {
    const { mirror, fs, changes } = await watched();
    mirror.client.index = async () => [];
    await fs.recheck();
    expect(mirror.reads).toEqual([]);
    expect(changes).toEqual([]);
    expect(await fs.readText(PATH)).toBe(BASE);
  });

  it("6.1d resolves quietly and changes nothing when the index cannot be read", async () => {
    const { mirror, fs, changes } = await watched();
    mirror.other("one\nTWO\nthree\nfour\n");
    mirror.client.index = async () => { throw new Error("offline"); };
    await expect(fs.recheck()).resolves.toBeUndefined();
    expect(changes).toEqual([]);
    expect(await fs.readText(PATH)).toBe(BASE);
  });
});

describe("A8 an edit of a file whose row changed since it was read", () => {
  const paragraphs = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n";

  it("A8 saves without the notice when the row changed in another paragraph and ends with both edits", async () => {
    const mirror = fakeMirror(paragraphs);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    mirror.other("First paragraph here.\n\nSecond paragraph, edited elsewhere.\n\nThird paragraph here.\n");
    await expect(fs.writeText(PATH, "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph, edited here.\n")).resolves.toBeUndefined();
    const both = "First paragraph here.\n\nSecond paragraph, edited elsewhere.\n\nThird paragraph, edited here.\n";
    expect(mirror.row.text).toBe(both);
    expect(await fs.readText(PATH)).toBe(both);
  });

  it("A8 still rejects with the notice when the same paragraph changed on both sides", async () => {
    const mirror = fakeMirror(paragraphs);
    const fs = await createMirrorFileSystem(ROWS, mirror.client, 5, textMerge);
    await fs.readText(PATH);
    mirror.other("First paragraph here.\n\nSecond paragraph, theirs.\n\nThird paragraph here.\n");
    await expect(fs.writeText(PATH, "First paragraph here.\n\nSecond paragraph, mine.\n\nThird paragraph here.\n")).rejects.toThrow(CONFLICT_NOTICE);
    expect(mirror.row.text).toBe("First paragraph here.\n\nSecond paragraph, theirs.\n\nThird paragraph here.\n");
  });
});
