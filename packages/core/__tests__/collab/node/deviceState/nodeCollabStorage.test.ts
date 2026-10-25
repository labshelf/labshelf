/** Pins that a share's state survives a restart in its on-disk format, compacted, without leaking paths into file names. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Y from "yjs";
import { deriveContentKey } from "../../../../src/collab/shareKey/index";
import { fileText, indexFiles } from "../../../../src/collab/model/index";
import { docFileStem, nodeCollabStorage } from "../../../../src/collab/node/index";
import { openCollabStore as openStore } from "../../../../src/collab/deviceState/index";
import type { ILogger } from "../../../../src/ports/index";
import { createShareSession } from "../../../../src/collab/doc/shareSession";
import { deriveDocId } from "../../../../src/collab/peer/docId";
import { INDEX_DOC_KEY } from "../../../../src/collab/doc/docSync";
import { deriveSha256Hex } from "../../../../src/hash/index";
import { FakeClock, FakeNetwork } from "../../peer/fakeNetwork";
import { fakeLogger, SHARE_ID, SHARE_KEY } from "../../doc/testSession";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const openCollabStore = ({ dir, logger }: { dir: string; shareId: string; logger: ILogger }) =>
  openStore({ storage: nodeCollabStorage({ dir, shareId: SHARE_ID }), logger });
const record = (update: Uint8Array) => Buffer.concat([Buffer.from([0, 0, 0, 0].map((_, i) => (update.length >>> (24 - 8 * i)) & 0xff)), update]);

describe("collab store", () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-collab-store-")); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("names doc files by the doc id the wire uses, never by path", async () => {
    expect(docFileStem(SHARE_ID, "chapters/intro.typ")).toBe(hex(await deriveDocId(SHARE_ID, "chapters/intro.typ")));
    expect(docFileStem(SHARE_ID, INDEX_DOC_KEY)).toBe(hex(await deriveDocId(SHARE_ID, INDEX_DOC_KEY)));
  });

  it("restores the index and file docs after a restart, with no peer, and compacts the log into the snapshot", async () => {
    const logger = fakeLogger();
    const first = await openCollabStore({ dir, shareId: SHARE_ID, logger });
    indexFiles(first.index).set("main.typ", { kind: "text" });
    const doc = first.createDoc("main.typ");
    fileText(doc).insert(0, "Hello");
    fileText(doc).insert(5, " world");
    await first.close();
    const names = await fs.readdir(path.join(dir, "docs"));
    expect(names.some((name) => name.includes("main"))).toBe(false);
    expect(names.some((name) => name.endsWith(".log"))).toBe(true);

    const clock = new FakeClock();
    const second = await openCollabStore({ dir, shareId: SHARE_ID, logger });
    const session = createShareSession({
      shareId: SHARE_ID, contentKey: await deriveContentKey(SHARE_KEY), transport: new FakeNetwork(clock).join("alone"),
      logger, scheduler: clock, index: second.index, createDoc: second.createDoc,
    });
    expect(indexFiles(session.index).get("main.typ")).toEqual({ kind: "text" });
    expect(fileText(session.openDoc("main.typ")).toString()).toBe("Hello world");
    await session.close();
    await second.close();
    expect((await fs.readdir(path.join(dir, "docs"))).some((name) => name.endsWith(".log"))).toBe(false);
  });

  it("keeps the records before a torn final append and logs it", async () => {
    const logger = fakeLogger();
    const first = await openCollabStore({ dir, shareId: SHARE_ID, logger });
    fileText(first.createDoc("a.typ")).insert(0, "kept");
    await first.close();
    const log = path.join(dir, "docs", `${docFileStem(SHARE_ID, "a.typ")}.log`);
    await fs.appendFile(log, Uint8Array.from([0, 0, 0, 50, 1, 2]));
    const second = await openCollabStore({ dir, shareId: SHARE_ID, logger });
    expect(fileText(second.createDoc("a.typ")).toString()).toBe("kept");
    expect(logger.log.mock.calls.some(([level]) => level === "WARN")).toBe(true);
    await second.close();
  });

  it("serves the blobs it holds by hash and refuses a malformed hash", async () => {
    const store = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    const bytes = Uint8Array.from([1, 2, 3, 255]);
    const hash = await store.blobs.put(bytes);
    expect(hash).toBe(await deriveSha256Hex(bytes));
    expect(await store.blobs.get(hash)).toEqual(bytes);
    expect(await store.blobs.get("0".repeat(64))).toBeUndefined();
    expect(await store.blobs.get("../../etc/passwd")).toBeUndefined();
    await store.close();
  });

  it("remembers the last synced hash of each file across a restart", async () => {
    const first = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    first.known.set("main.typ", "a".repeat(64));
    first.known.set("gone.typ", "b".repeat(64));
    first.known.delete("gone.typ");
    await first.close();
    const second = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    expect(second.known.get("main.typ")).toBe("a".repeat(64));
    expect(second.known.get("gone.typ")).toBeUndefined();
    await second.close();
  });

  it("does not store the state it restores again", async () => {
    const first = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    fileText(first.createDoc("a.typ")).insert(0, "x");
    await first.close();
    const second = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    const doc = second.createDoc("a.typ");
    await second.flush();
    expect((await fs.readdir(path.join(dir, "docs"))).filter((name) => name.endsWith(".log"))).toEqual([]);
    expect(doc).toBeInstanceOf(Y.Doc);
    await second.close();
  });

  it("keeps the relay cursors of each relay across a restart, after the doc updates they cover are on disk", async () => {
    const logger = fakeLogger();
    const first = await openCollabStore({ dir, shareId: SHARE_ID, logger });
    fileText(first.createDoc("main.typ")).insert(0, "from the relay");
    first.relayCursors("https://a.example").set("main.typ", 41);
    first.relayCursors("https://a.example").set(INDEX_DOC_KEY, 7);
    first.relayCursors("https://b.example").set("main.typ", 3);
    await first.close();
    const second = await openCollabStore({ dir, shareId: SHARE_ID, logger });
    expect(second.relayCursors("https://a.example").get("main.typ")).toBe(41);
    expect(second.relayCursors("https://a.example").get(INDEX_DOC_KEY)).toBe(7);
    expect(second.relayCursors("https://a.example").get("other.typ")).toBeUndefined();
    expect(second.relayCursors("https://b.example").get("main.typ")).toBe(3);
    expect(second.relayCursors("https://c.example").get("main.typ")).toBeUndefined();
    expect(fileText(second.createDoc("main.typ")).toString()).toBe("from the relay");
    await second.close();
  });

  it("reads a snapshot and log written in the stored format and leaves one snapshot of both", async () => {
    const base = new Y.Doc();
    fileText(base).insert(0, "snap");
    const snapshot = Y.encodeStateAsUpdate(base);
    const before = Y.encodeStateVector(base);
    fileText(base).insert(4, "+log");
    const update = Y.encodeStateAsUpdate(base, before);
    const stem = docFileStem(SHARE_ID, "a.typ");
    await fs.mkdir(path.join(dir, "docs"), { recursive: true });
    await fs.writeFile(path.join(dir, "docs", `${stem}.snapshot`), snapshot);
    await fs.writeFile(path.join(dir, "docs", `${stem}.log`), Buffer.concat([record(update), record(update)]));
    await fs.writeFile(path.join(dir, "relay-cursors.json"), JSON.stringify({ "https://a.example a.typ": 5 }));
    const store = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    expect(fileText(store.createDoc("a.typ")).toString()).toBe("snap+log");
    expect(store.relayCursors("https://a.example").get("a.typ")).toBe(5);
    expect(await fs.readdir(path.join(dir, "docs"))).toEqual([`${stem}.snapshot`]);
    await store.close();
  });

  it("appends each update as a 4-byte big-endian length and the update", async () => {
    const store = await openCollabStore({ dir, shareId: SHARE_ID, logger: fakeLogger() });
    const doc = store.createDoc("a.typ");
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));
    fileText(doc).insert(0, "x");
    await store.close();
    const log = await fs.readFile(path.join(dir, "docs", `${docFileStem(SHARE_ID, "a.typ")}.log`));
    expect(log).toEqual(record(updates[0]!));
  });
});
