/** Pins the store rules over any storage: hydration, compaction, and that relay cursors never claim updates not stored. */
import * as Y from "yjs";
import { fileText } from "../../../src/collab/model/index";
import { openCollabStore } from "../../../src/collab/state/index";
import { fakeLogger } from "../sync/testSession";
import { memoryStorage } from "./memoryStorage";

const RELAY = "https://relay.example";
const textOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return fileText(doc).toString();
};

describe("collab store rules", () => {
  it("restores a doc after a restart and compacts its updates into one snapshot", async () => {
    const storage = memoryStorage();
    const first = await openCollabStore({ storage, logger: fakeLogger() });
    fileText(first.createDoc("a.typ")).insert(0, "Hello");
    fileText(first.createDoc("b.typ")).insert(0, "other");
    await first.close();
    expect(storage.docs.get("doc:a.typ")?.updates.length).toBe(1);

    const second = await openCollabStore({ storage, logger: fakeLogger() });
    expect(fileText(second.createDoc("a.typ")).toString()).toBe("Hello");
    expect(storage.docs.get("doc:a.typ")).toEqual({ snapshot: expect.any(Uint8Array), updates: [], torn: false });
    await second.close();
    expect(storage.docs.get("doc:a.typ")?.updates).toEqual([]);
  });

  it("applies a duplicated update once", async () => {
    const storage = memoryStorage();
    const source = new Y.Doc();
    fileText(source).insert(0, "once");
    const update = Y.encodeStateAsUpdate(source);
    storage.docs.set("doc:a.typ", { updates: [update, update], torn: false });
    const store = await openCollabStore({ storage, logger: fakeLogger() });
    expect(fileText(store.createDoc("a.typ")).toString()).toBe("once");
    await store.close();
  });

  it("drops a torn log tail, keeps the records before it and warns", async () => {
    const storage = memoryStorage();
    const source = new Y.Doc();
    fileText(source).insert(0, "kept");
    storage.docs.set("doc:a.typ", { updates: [Y.encodeStateAsUpdate(source)], torn: true });
    const logger = fakeLogger();
    const store = await openCollabStore({ storage, logger });
    expect(fileText(store.createDoc("a.typ")).toString()).toBe("kept");
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
    fileText(store.createDoc("a.typ")).insert(0, "lost?");
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
    fileText(doc).insert(0, "first");
    store.relayCursors(RELAY).set("a.typ", 1);
    await expect(store.flush()).rejects.toThrow();
    storage.failAppends = false;
    storage.failCompactions = false;
    fileText(doc).insert(5, " second");
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
    fileText(store.createDoc("a.typ")).insert(0, "late");
    store.relayCursors(RELAY).set("a.typ", 4);
    await expect(store.flush()).rejects.toThrow();
    storage.failCompactions = false;
    await store.close();
    const reopened = await openCollabStore({ storage, logger: fakeLogger() });
    expect(fileText(reopened.createDoc("a.typ")).toString()).toBe("late");
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
});
