// Pins cloud copies that arrive ahead of relay updates across two project mirrors.
import { reconcileBlob } from "../../../src/collab/mirror/blobMirror";
import { mergeText } from "../../../src/writing/conflict/node/index";
import { deriveSha256Hex } from "../../../src/hash/index";
import { fileText, indexFiles, recordWritten, replaceFileText } from "../../../src/collab/model/index";
import { FakeClock, runUntil } from "../peer/fakeNetwork";
import { FakeRelay, runFor } from "../transport/relay/fakeRelay";
import { memoryFiles } from "./mirrorFiles";
import { openMirror, readFile, writeFile, type MirrorFixture } from "./mirrorFixture";

const path = "main.tex";
const before = "Title\nIntro\nMiddle\nMore\nEnd\n";
const after = "Title\nPeer intro\nMiddle\nMore\nEnd\n";
const text = (device: MirrorFixture) => fileText(device.session.openDoc(path)).toString();

describe("in-flight mirror writes", () => {
  let fixtures: MirrorFixture[] = [];
  afterEach(async () => { await Promise.all(fixtures.map((fixture) => fixture.close())); fixtures = []; });

  async function pair(file = path, content: string | Uint8Array = before) {
    const clock = new FakeClock();
    const relay = new FakeRelay(clock);
    const files = memoryFiles();
    const a = await openMirror({ relay, clock, files });
    fixtures.push(a);
    await writeFile(a, file, content);
    a.mirror.changed(file);
    await a.mirror.idle();
    const b = await openMirror({ relay, clock, files });
    fixtures.push(b);
    expect(await runUntil(clock, () => b.store.known.get(file) === a.store.known.get(file))).toBe(true);
    await Promise.all(fixtures.map((fixture) => fixture.mirror.idle()));
    return { a, b, clock, relay };
  }

  async function cloudCopy(a: MirrorFixture, b: MirrorFixture, file: string, recordsAfter = false) {
    if (recordsAfter) {
      await writeFile(b, file, (await a.files.read(a.folder, file))!);
      b.mirror.changed(file);
      await b.mirror.idle();
    }
    for (const recordPath of await a.files.recordPaths(a.folder)) {
      await writeFile(b, recordPath, (await a.files.read(a.folder, recordPath))!);
      b.mirror.changed(recordPath);
    }
    await writeFile(b, file, (await a.files.read(a.folder, file))!);
    b.mirror.changed(file);
    await b.mirror.idle();
  }

  it.each([false, true])("A4 keeps a cloud text copy out before relay updates, records copied after file: %s", async (recordsAfter) => {
    const { a, b, clock } = await pair();
    replaceFileText(a.session.openDoc(path), after, "editor");
    await a.mirror.idle();
    expect(await readFile(a, path)).toBe(after);
    await cloudCopy(a, b, path, recordsAfter);
    expect(text(b)).toBe(before);
    expect(text(a)).toBe(after);
    expect(await readFile(b, path)).toBe(after);
    expect(await runUntil(clock, () => text(b) === after)).toBe(true);
    await b.mirror.idle();
    expect(text(a)).toBe(after);
    expect(text(b)).toBe(after);
  });

  it("keeps a binary cloud copy out until written changes for its path", async () => {
    const initial = new Uint8Array([1, 2, 3]);
    const bytes = new Uint8Array([4, 5, 6]);
    const file = "plot.png";
    const { a, b } = await pair(file, initial);
    const previous = indexFiles(b.session.index).get(file)?.hash;
    const hash = await a.store.blobs.put(bytes);
    indexFiles(a.session.index).set(file, { kind: "blob", hash });
    await a.mirror.idle();
    await cloudCopy(a, b, file);
    expect(indexFiles(b.session.index).get(file)?.hash).toBe(previous);
    recordWritten(b.session.index, file, hash, Date.now());
    await b.mirror.idle();
    expect(await b.files.read(b.folder, file)).toEqual(initial);
  });

  it("keeps a recorded write waiting across a long disconnection, then accepts a newer outside edit", async () => {
    const { a, b, clock, relay } = await pair();
    relay.up = false;
    relay.dropAll();
    replaceFileText(a.session.openDoc(path), after, "editor");
    await a.mirror.idle();
    await cloudCopy(a, b, path);
    await runFor(clock, 60_000, 1000);
    await b.mirror.idle();
    expect(text(b)).toBe(before);
    const outside = "Title\nIntro\nMiddle\nMore\nOutside end\n";
    await writeFile(b, path, outside);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(text(b)).toBe(outside);
  });

  it.each(["records", "blob cache"])("keeps a blob stale version out when written arrives during %s", async (stage) => {
    const initial = new Uint8Array([1, 2, 3]);
    const bytes = new Uint8Array([4, 5, 6]);
    const file = "plot.png";
    const { b } = await pair(file, initial);
    await b.mirror.close();
    const hash = await deriveSha256Hex(bytes);
    const entry = indexFiles(b.session.index).get(file)!;
    let entered!: () => void;
    const arrived = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const pause = async () => { entered(); await blocked; };
    const read = b.writeRecords.read;
    const put = b.store.blobs.put.bind(b.store.blobs);
    const spy = jest.spyOn(b.store.blobs, "put").mockImplementation(async (data: Uint8Array) => { if (stage === "blob cache") { await pause(); } return put(data); });
    const context = {
      folder: b.folder, disk: b.files.disk(b.folder, b.logger), mergeText,
      session: { ...b.session, indexRoundTrip: () => undefined }, blobs: b.blobs,
      store: b.store,
      writeRecords: { ...b.writeRecords, read: async () => { if (stage === "records") { await pause(); } return read(); } },
      logger: b.logger, settingsBase: undefined, missingBlobs: new Set<string>(), waitingWrites: new Map(),
      request: () => {}, attach: () => {},
    };
    const work = reconcileBlob(context, file, entry, { state: "present", bytes }, true);
    await arrived;
    recordWritten(b.session.index, file, hash, Date.now());
    release();
    await work;
    expect(indexFiles(b.session.index).get(file)).toEqual(entry);
    spy.mockRestore();
  });

  it("uses an app write's recorded parent before the closest stored text", async () => {
    const { a, b, clock } = await pair();
    replaceFileText(a.session.openDoc(path), after, "editor");
    expect(await runUntil(clock, () => text(b) === after)).toBe(true);
    await b.mirror.idle();
    const outside = "Title\nIntro\nMiddle\nMore\nOutside end\n";
    const parent = await deriveSha256Hex(new TextEncoder().encode(before));
    const hash = await deriveSha256Hex(new TextEncoder().encode(outside));
    b.store.rememberVersion(path, await deriveSha256Hex(new TextEncoder().encode(outside + "noise\n")), outside + "noise\n");
    await b.writeRecords.append({ path, hash, parent, by: "app", at: Date.now() });
    await writeFile(b, path, outside);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(await runUntil(clock, () => text(b).includes("Outside end"))).toBe(true);
    expect(text(b)).toBe("Title\nPeer intro\nMiddle\nMore\nOutside end\n");
  });

  it("retries an unknown edit when its canceled relay round trip gets a replacement provider", async () => {
    const { b } = await pair();
    let cancel!: (answered: boolean) => void;
    const detach = b.session.registerIndexRoundTrip(() => new Promise<boolean>((resolve) => { cancel = resolve; }));
    await writeFile(b, path, after);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(text(b)).toBe(before);
    cancel(false);
    await Promise.resolve();
    detach();
    const replacement = b.session.registerIndexRoundTrip(async () => true);
    await b.mirror.idle();
    expect(text(b)).toBe(after);
    replacement();
  });

  it("does not recreate a project deleted while the record's ownership gate waits", async () => {
    const files = memoryFiles();
    let entered!: () => void;
    const arrived = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let hold = false;
    const b = await openMirror({ files, ownership: { assertOwned: async () => { if (hold) { entered(); await blocked; } } } });
    fixtures.push(b);
    await writeFile(b, path, before);
    b.mirror.changed(path);
    await b.mirror.idle();
    hold = true;
    replaceFileText(b.session.openDoc(path), after, "editor");
    await arrived;
    await files.removeFolder(b.folder);
    release();
    await b.mirror.idle();
    expect(await files.recordPaths(b.folder)).toEqual([]);
    expect(await files.read(b.folder, path)).toBeUndefined();
  });

  it("retries a refused round trip after a later change of the same disk hash", async () => {
    const { b } = await pair();
    let answered = false;
    const detach = b.session.registerIndexRoundTrip(async () => answered);
    await writeFile(b, path, after);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(text(b)).toBe(before);
    answered = true;
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(text(b)).toBe(after);
    detach();
  });

  it("A4 keeps an in-flight file creation out before its index entry arrives", async () => {
    const { a, b, clock } = await pair();
    const file = "chapter.tex";
    replaceFileText(a.session.openDoc(file), after, "editor");
    indexFiles(a.session.index).set(file, { kind: "text" });
    await a.mirror.idle();
    await cloudCopy(a, b, file);
    expect(indexFiles(b.session.index).has(file)).toBe(false);
    expect(fileText(b.session.openDoc(file)).toString()).toBe("");
    expect(await runUntil(clock, () => fileText(b.session.openDoc(file)).toString() === after)).toBe(true);
    await b.mirror.idle();
    expect(fileText(a.session.openDoc(file)).toString()).toBe(after);
    expect(fileText(b.session.openDoc(file)).toString()).toBe(after);
  });

  it("preserves an outside edit when the relay removes its index entry during record lookup", async () => {
    const { b } = await pair();
    const outside = "Title\nIntro\nMiddle\nMore\nOutside end\n";
    await writeFile(b, path, outside);
    let entered!: () => void;
    const arrived = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const read = b.writeRecords.read;
    let first = true;
    const spy = jest.spyOn(b.writeRecords, "read").mockImplementation(async () => {
      if (first) { first = false; entered(); await blocked; }
      return read();
    });
    const detach = b.session.registerIndexRoundTrip(() => undefined);
    b.mirror.changed(path);
    await arrived;
    indexFiles(b.session.index).delete(path);
    release();
    await b.mirror.idle();
    expect(indexFiles(b.session.index).has(path)).toBe(true);
    expect(text(b)).toBe(outside);
    expect(await readFile(b, path)).toBe(outside);
    detach();
    spy.mockRestore();
  });

  it("waits for its relay round trip when no peer is connected", async () => {
    const { a, b, clock } = await pair();
    await a.close();
    fixtures = [b];
    expect(await runUntil(clock, () => b.session.peers.length === 0)).toBe(true);
    await writeFile(b, path, after);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(text(b)).toBe(before);
    expect(await runUntil(clock, () => text(b) === after)).toBe(true);
  });

  it("takes an unknown outside edit only after a fresh index since is answered", async () => {
    const { a, b, clock } = await pair();
    await writeFile(b, path, after);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(text(b)).toBe(before);
    expect(await runUntil(clock, () => text(b) === after)).toBe(true);
    expect(await runUntil(clock, () => text(a) === after)).toBe(true);
  });

  it("keeps disk bytes intact when recording a mirror write fails", async () => {
    const b = await openMirror();
    fixtures.push(b);
    await writeFile(b, path, before);
    b.mirror.changed(path);
    await b.mirror.idle();
    jest.spyOn(b.writeRecords, "append").mockRejectedValueOnce(new Error("Record unavailable"));
    replaceFileText(b.session.openDoc(path), after, "editor");
    await b.mirror.idle();
    expect(await readFile(b, path)).toBe(before);
    expect(text(b)).toBe(after);
    b.mirror.changed(path);
    await b.mirror.idle();
    expect(await readFile(b, path)).toBe(after);
  });
});
