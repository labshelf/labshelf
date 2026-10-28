/** Pins the IndexedDB share state: restored after a restart, atomic compaction, namespaces apart and failed writes rejecting; and stable per-library device identities across browser tabs and share deletion. */
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { readFileText, openCollabStore, type ILogger } from "@labshelf/core";
import { createBrowserDeviceIdentity, removeBrowserCollabDocs, openBrowserCollabStorage } from "../../src/storage/collab";

const RELAY = "wss://relay.example";
const HASH = "a".repeat(64);
let count = 0;
let ns: string;
const logger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });
const update = (text: string) => {
  const doc = new Y.Doc();
  readFileText(doc).insert(0, text);
  return Y.encodeStateAsUpdate(doc);
};

/** Makes every put into `storeName` abort its transaction once the put succeeded, as a quota failure at commit does. */
function abortPutsInto(storeName: string): jest.SpyInstance {
  const put = IDBObjectStore.prototype.put;
  return jest.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args);
    if (this.name === storeName) { request.addEventListener("success", () => this.transaction.abort()); }
    return request;
  });
}

beforeEach(() => { count += 1; ns = `library-${count}/share`; });
afterEach(() => jest.restoreAllMocks());

describe("browser collab storage", () => {
  it("restores docs, known hashes and relay cursors in a store opened after a restart", async () => {
    const first = await openCollabStore({ storage: openBrowserCollabStorage(ns), logger: logger() });
    readFileText(first.createDoc("chapters/a.typ")).insert(0, "Hello");
    first.known.set("chapters/a.typ", HASH);
    first.relayCursors(RELAY).set("chapters/a.typ", 7);
    await first.close();

    const second = await openCollabStore({ storage: openBrowserCollabStorage(ns), logger: logger() });
    expect(readFileText(second.createDoc("chapters/a.typ")).toString()).toBe("Hello");
    expect(second.known.get("chapters/a.typ")).toBe(HASH);
    expect(second.relayCursors(RELAY).get("chapters/a.typ")).toBe(7);
    await second.close();
  });

  it("keeps appended updates in order and replaces them with the snapshot on compaction", async () => {
    const storage = openBrowserCollabStorage(ns);
    const [one, two] = [update("one"), update("two")];
    await storage.appendUpdate("a.typ", one);
    await storage.appendUpdate("a.typ", two);
    expect((await storage.loadDocs()).get("a.typ")).toEqual({ updates: [one, two], torn: false });

    const state = update("whole");
    await storage.compactDoc("a.typ", state);
    expect((await storage.loadDocs()).get("a.typ")).toEqual({ snapshot: state, updates: [], torn: false });
  });

  it("keeps the old state and log when a compaction fails", async () => {
    const storage = openBrowserCollabStorage(ns);
    const [snapshot, appended] = [update("old"), update("appended")];
    await storage.compactDoc("a.typ", snapshot);
    await storage.appendUpdate("a.typ", appended);
    abortPutsInto("docs");
    await expect(storage.compactDoc("a.typ", update("new"))).rejects.toBeDefined();
    jest.restoreAllMocks();
    expect((await storage.loadDocs()).get("a.typ")).toEqual({ snapshot, updates: [appended], torn: false });
  });

  it("rejects a failed append, and the store then holds the relay cursor back", async () => {
    const storage = openBrowserCollabStorage(ns);
    abortPutsInto("updates");
    await expect(storage.appendUpdate("a.typ", update("lost"))).rejects.toBeDefined();
    expect((await storage.loadDocs()).get("a.typ")).toBeUndefined();

    const store = await openCollabStore({ storage, logger: logger() });
    abortPutsInto("docs");
    readFileText(store.createDoc("a.typ")).insert(0, "unstored");
    store.relayCursors(RELAY).set("a.typ", 3);
    await expect(store.close()).rejects.toThrow("not stored");
    jest.restoreAllMocks();
    expect(await storage.loadMap("relay-cursors")).toBeUndefined();
  });

  it("keeps two namespaces apart and deletes only the state of one", async () => {
    const other = `${ns}-other`;
    for (const name of [ns, other]) {
      const storage = openBrowserCollabStorage(name);
      await storage.appendUpdate("a.typ", update(name));
      await storage.saveMap("known", { "a.typ": name });
      await storage.writeBlob(HASH, new TextEncoder().encode(name));
    }
    const mine = openBrowserCollabStorage(ns);
    expect(await mine.loadMap("known")).toEqual({ "a.typ": ns });
    expect(new TextDecoder().decode(await mine.readBlob(HASH))).toBe(ns);

    await removeBrowserCollabDocs(ns);
    expect((await mine.loadDocs()).size).toBe(0);
    expect(await mine.loadMap("known")).toBeUndefined();
    expect(await mine.readBlob(HASH)).toBeUndefined();
    const theirs = openBrowserCollabStorage(other);
    expect((await theirs.loadDocs()).get("a.typ")?.updates).toHaveLength(1);
    expect(await theirs.loadMap("known")).toEqual({ "a.typ": other });
    expect(new TextDecoder().decode(await theirs.readBlob(HASH))).toBe(other);
  });

  it("stores a doc under its doc key", () => {
    expect(openBrowserCollabStorage(ns).docId("chapters/a.typ")).toBe("chapters/a.typ");
  });
});

describe("browser device identity", () => {
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
  afterEach(() => jest.restoreAllMocks());

  it("keeps one identity across concurrent tabs, reopened stores and deleted shares", async () => {
    const first = createBrowserDeviceIdentity("identity-library", logger);
    const second = createBrowserDeviceIdentity("identity-library", logger);
    const [one, two] = await Promise.all([first.id(), second.id()]);
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(two).toBe(one);
    await removeBrowserCollabDocs("identity-library/share");
    expect(await createBrowserDeviceIdentity("identity-library", logger).id()).toBe(one);
    expect(await createBrowserDeviceIdentity("other-library", logger).id()).not.toBe(one);
  });

  it("surfaces a failed identity commit and retries with durable storage", async () => {
    const put = IDBObjectStore.prototype.put;
    const failing = jest.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    const identity = createBrowserDeviceIdentity("failed-identity-library", logger);
    await expect(identity.id()).rejects.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
    failing.mockRestore();
    const id = await identity.id();
    expect(await createBrowserDeviceIdentity("failed-identity-library", logger).id()).toBe(id);
  });
});
