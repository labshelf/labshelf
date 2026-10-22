// Pins stale text, binary restores and offline edits across two relayed project mirrors.
import { fileText, indexFiles } from "../../../src/collab/model/index";
import { reconcileText } from "../../../src/collab/mirror/reconcile/index";
import { mergeText } from "../../../src/writing/merge/node/index";
import { FakeClock, runUntil } from "../sync/fakeNetwork";
import { FakeRelay } from "../transport/relay/fakeRelay";
import { memoryFiles } from "./mirrorFiles";
import { openMirror, readFile, writeFile, type MirrorFixture } from "./mirrorFixture";

const original = "Title\nIntro\nMiddle\nMore\nEnd\n";
const shared = "Title\nPeer intro\nMiddle\nMore\nEnd\n";
const edited = "Title\nIntro\nMiddle\nMore\nOutside end\n";
const merged = "Title\nPeer intro\nMiddle\nMore\nOutside end\n";

const text = (fixture: MirrorFixture) => fileText(fixture.session.openDoc("main.tex")).toString();

describe("stale versions through the relay", () => {
  let fixtures: MirrorFixture[] = [];
  afterEach(async () => { await Promise.all(fixtures.map((fixture) => fixture.close())); fixtures = []; });

  async function pair(file: string, content: string | Uint8Array) {
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
    return { a, b, clock, relay, files };
  }

  it("A1 rewrites an old text without reverting either document", async () => {
    const { a, b, clock } = await pair("main.tex", original);
    await writeFile(b, "main.tex", shared);
    b.mirror.changed("main.tex");
    expect(await runUntil(clock, () => text(a) === shared && a.store.known.get("main.tex") === b.store.known.get("main.tex"))).toBe(true);
    await Promise.all(fixtures.map((fixture) => fixture.mirror.idle()));
    await writeFile(a, "main.tex", original);
    a.mirror.changed("main.tex");
    await a.mirror.idle();
    expect(text(a)).toBe(shared);
    expect(text(b)).toBe(shared);
    expect(await readFile(a, "main.tex")).toBe(shared);
  });

  it("A2 rewrites an old blob without replacing the index entry", async () => {
    const before = new Uint8Array([1, 2, 3]);
    const after = new Uint8Array([4, 5, 6]);
    const { a, b, clock } = await pair("plot.png", before);
    await writeFile(b, "plot.png", after);
    b.mirror.changed("plot.png");
    await b.mirror.idle();
    const nextHash = await b.store.blobs.put(after);
    expect(await runUntil(clock, () => indexFiles(b.session.index).get("plot.png")?.hash === nextHash)).toBe(true);
    const hash = indexFiles(b.session.index).get("plot.png")?.hash;
    expect(await runUntil(clock, () => a.store.known.get("plot.png") === hash)).toBe(true);
    await writeFile(a, "plot.png", before);
    a.mirror.changed("plot.png");
    await a.mirror.idle();
    expect(indexFiles(a.session.index).get("plot.png")?.hash).toBe(hash);
    expect(indexFiles(b.session.index).get("plot.png")?.hash).toBe(hash);
    expect(await a.files.read(a.folder, "plot.png")).toEqual(after);
  });

  it("A3 merges only the outside edit from an older version after restarting", async () => {
    const { a, b, clock, relay, files } = await pair("main.tex", original);
    await writeFile(b, "main.tex", shared);
    b.mirror.changed("main.tex");
    expect(await runUntil(clock, () => text(a) === shared && a.store.known.get("main.tex") === b.store.known.get("main.tex"))).toBe(true);
    await a.close();
    fixtures = [b];
    await writeFile(a, "main.tex", edited);
    const restarted = await openMirror({ relay, clock, files, folder: a.folder, stateDir: a.stateDir });
    fixtures.push(restarted);
    await restarted.mirror.idle();
    expect(text(restarted)).toBe(merged);
    expect(await runUntil(clock, () => text(b) === merged)).toBe(true);
    await Promise.all(fixtures.map((fixture) => fixture.mirror.idle()));
    expect(await readFile(restarted, "main.tex")).toBe(merged);
    expect(await readFile(b, "main.tex")).toBe(merged);
  });

  it("merges against peer edits received while hashing the disk text", async () => {
    const { a, b, clock } = await pair("main.tex", original);
    await a.mirror.close();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const spy = jest.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
      const result = await digest(algorithm, data);
      if (!held && new TextDecoder().decode(data) === edited) { held = true; await blocked; }
      return result;
    });
    const reconciliation = reconcileText({
      folder: a.folder, disk: a.files.disk(a.folder, a.logger), mergeText, session: { ...a.session, indexRoundTrip: () => undefined },
      blobs: a.blobs, store: a.store, logger: a.logger, settingsBase: undefined,
      writeRecords: a.writeRecords, waitingWrites: new Map(), missingBlobs: new Set(), request: () => {}, attach: () => {},
    }, "main.tex", { state: "present", bytes: new TextEncoder().encode(edited) }, true);
    try {
      expect(await runUntil(clock, () => held)).toBe(true);
      await writeFile(b, "main.tex", shared);
      b.mirror.changed("main.tex");
      expect(await runUntil(clock, () => text(a) === shared)).toBe(true);
      release();
      await reconciliation;
      expect(text(a)).toBe(merged);
    } finally {
      release();
      await reconciliation;
      spy.mockRestore();
    }
  });

});
