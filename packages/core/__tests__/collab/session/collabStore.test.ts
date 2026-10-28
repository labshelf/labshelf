/** Pins the store rules over any storage: hydration, compaction, that relay cursors never claim updates not stored, and durable merge bases with bounded versions. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Y from "yjs";
import { readFileText, readShareIndexDocFiles, addWrittenVersion, readWrittenHashes } from "../../../src/collab/index";
import { createNodeCollabStorage } from "../../../src/collab/session/node/index";
import { openCollabStore } from "../../../src/collab/session/index";
import { fakeLogger } from "../testSession";
import { memoryStorage } from "./memoryStorage";

const RELAY = "https://relay.example";
const textOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return readFileText(doc).toString();
};

describe("collab store rules", () => {
  it("restores a doc after a restart and compacts its updates into one snapshot", async () => {
    const storage = memoryStorage();
    const first = await openCollabStore({ storage, logger: fakeLogger() });
    readFileText(first.createDoc("a.typ")).insert(0, "Hello");
    readFileText(first.createDoc("b.typ")).insert(0, "other");
    await first.close();
    expect(storage.docs.get("doc:a.typ")?.updates.length).toBe(1);

    const second = await openCollabStore({ storage, logger: fakeLogger() });
    expect(readFileText(second.createDoc("a.typ")).toString()).toBe("Hello");
    expect(storage.docs.get("doc:a.typ")).toEqual({ snapshot: expect.any(Uint8Array), updates: [], torn: false });
    await second.close();
    expect(storage.docs.get("doc:a.typ")?.updates).toEqual([]);
  });

  it("applies a duplicated update once", async () => {
    const storage = memoryStorage();
    const source = new Y.Doc();
    readFileText(source).insert(0, "once");
    const update = Y.encodeStateAsUpdate(source);
    storage.docs.set("doc:a.typ", { updates: [update, update], torn: false });
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    expect(readFileText(store.createDoc("a.typ")).toString()).toBe("once");
    await store.close();
  });

  it("drops a torn log tail, keeps the records before it and warns", async () => {
    const storage = memoryStorage();
    const source = new Y.Doc();
    readFileText(source).insert(0, "kept");
    storage.docs.set("doc:a.typ", { updates: [Y.encodeStateAsUpdate(source)], torn: true });
    const logger = fakeLogger();
    const store = await openCollabStore({ storage, logger });
    expect(readFileText(store.createDoc("a.typ")).toString()).toBe("kept");
    expect(storage.docs.get("doc:a.typ")?.torn).toBe(false);
    expect(logger.log.mock.calls.some(([level]) => level === "WARN")).toBe(true);
    await store.close();
  });

  it("holds the relay cursor back while an update of its doc failed to store, and flush rejects", async () => {
    const storage = memoryStorage();
    const logger = fakeLogger();
    const store = await openCollabStore({ storage, logger });
    storage.failAppends = true;
    storage.failCompactions = true;
    readFileText(store.createDoc("a.typ")).insert(0, "lost?");
    store.relayCursors(RELAY).set("a.typ", 9);
    await expect(store.flush()).rejects.toThrow(/not stored/);
    expect(storage.maps.get("relay-cursors")).toBeUndefined();
    expect(logger.log.mock.calls.some(([level, , message]) => level === "WARN" && message.includes("relay cursors"))).toBe(true);
    await expect(store.close()).rejects.toThrow(/not stored/);
  });

  it("stores the full doc state on the next update after a failed append, then saves the cursor", async () => {
    const storage = memoryStorage();
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    const doc = store.createDoc("a.typ");
    storage.failAppends = true;
    storage.failCompactions = true;
    readFileText(doc).insert(0, "first");
    store.relayCursors(RELAY).set("a.typ", 1);
    await expect(store.flush()).rejects.toThrow();
    storage.failAppends = false;
    storage.failCompactions = false;
    readFileText(doc).insert(5, " second");
    store.relayCursors(RELAY).set("a.typ", 2);
    await store.flush();
    expect(storage.compactions).toContain("doc:a.typ");
    expect(textOf(storage.docs.get("doc:a.typ")!.snapshot!)).toBe("first second");
    expect(storage.maps.get("relay-cursors")).toEqual({ [`${RELAY} a.typ`]: 2 });
    await store.close();
  });

  it("retries a failed doc as a full-state compaction on flush, even while appends still fail", async () => {
    const storage = memoryStorage();
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    storage.failAppends = true;
    storage.failCompactions = true;
    readFileText(store.createDoc("a.typ")).insert(0, "late");
    store.relayCursors(RELAY).set("a.typ", 4);
    await expect(store.flush()).rejects.toThrow();
    storage.failCompactions = false;
    await store.close();
    const reopened = await openCollabStore({ storage, logger: fakeLogger() });
    expect(readFileText(reopened.createDoc("a.typ")).toString()).toBe("late");
    expect(reopened.relayCursors(RELAY).get("a.typ")).toBe(4);
    await reopened.close();
  });

  it("serves a held blob only while its bytes match its hash, and put repairs a corrupt copy", async () => {
    const storage = memoryStorage();
    const logger = fakeLogger();
    const store = await openCollabStore({ storage, logger });
    const bytes = Uint8Array.from([1, 2, 3]);
    const hash = await store.blobs.put(bytes);
    expect(await store.blobs.get(hash)).toEqual(bytes);
    storage.blobs.set(hash, Uint8Array.from([9]));
    expect(await store.blobs.get(hash)).toBeUndefined();
    expect(logger.log.mock.calls.some(([level]) => level === "WARN")).toBe(true);
    await store.blobs.put(bytes);
    expect(await store.blobs.get(hash)).toEqual(bytes);
    expect(await store.blobs.get("../../etc/passwd")).toBeUndefined();
    await store.close();
  });

  it("restores a relay's held state byte for byte after a restart", async () => {
    const storage = memoryStorage();
    const bytes = Y.encodeSnapshot(Y.snapshot(new Y.Doc()));
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    store.relayCursors(RELAY).setHeld("a.typ", bytes);
    await store.flush();
    await store.close();
    const reopened = await openCollabStore({ storage, logger: fakeLogger() });
    expect(reopened.relayCursors(RELAY).held("a.typ")).toEqual(bytes);
    expect(reopened.relayCursors("https://other.example").held("a.typ")).toBeUndefined();
    await reopened.close();
  });

  it("keeps a malformed held value as bytes that do not decode, so the caller reports it unreadable", async () => {
    const storage = memoryStorage();
    storage.maps.set("relay-held", { [`${RELAY} a.typ`]: "not base64!" });
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    const held = store.relayCursors(RELAY).held("a.typ");
    expect(held).toBeDefined();
    expect(() => Y.decodeSnapshot(held as Uint8Array)).toThrow();
    await store.close();
  });
});

describe("stored versions", () => {
  it("restores versions and merge bases after closing and reopening node storage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-versions-"));
    const open = () => openCollabStore({ storage: createNodeCollabStorage({ dir, shareId: "1".repeat(64) }), logger: fakeLogger() });
    try {
      const first = await open();
      first.rememberVersion("main.typ", "first", "base text");
      first.rememberVersion("main.typ", "second", "current text");
      first.bases.set("main.typ", "current text");
      await first.close();
      const second = await open();
      expect(second.storedVersions("main.typ")).toEqual([
        { hash: "first", text: "base text" }, { hash: "second", text: "current text" },
      ]);
      expect(second.bases.get("main.typ")).toBe("current text");
      expect(second.storedVersions("missing.typ")).toEqual([]);
      await second.close();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it("retains the latest 50 versions and coalesces repeated agreement", async () => {
    const storage = memoryStorage();
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    for (let i = 0; i < 55; i++) { store.rememberVersion("main.typ", String(i), `text ${i}`); }
    store.rememberVersion("main.typ", "54", "text 54");
    expect(store.storedVersions("main.typ")).toHaveLength(50);
    expect(store.storedVersions("main.typ")[0]).toEqual({ hash: "5", text: "text 5" });
    expect(store.storedVersions("main.typ")[49]).toEqual({ hash: "54", text: "text 54" });
    await store.close();
  });

  it("repairs competing written arrays immediately after restoring the index", async () => {
    const storage = memoryStorage();
    const first = await openCollabStore({ storage, logger: fakeLogger() });
    readShareIndexDocFiles(first.index).set("main.typ", { kind: "text" });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(first.index));
    addWrittenVersion(first.index, "main.typ", "mine", 1);
    addWrittenVersion(peer, "main.typ", "theirs", 2);
    await first.close();
    const reopened = await openCollabStore({ storage, logger: fakeLogger() });
    for (let round = 0; round < 3; round++) {
      Y.applyUpdate(reopened.index, Y.encodeStateAsUpdate(peer));
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(reopened.index));
    }
    expect(readWrittenHashes(reopened.index, "main.typ")).toEqual(new Set(["mine", "theirs"]));
    expect(readWrittenHashes(peer, "main.typ")).toEqual(new Set(["mine", "theirs"]));
    await reopened.close();
  });
});
