// Pins two pages over one notes.qmd: a note written through the paper notes store of one page reaches the replica of the other and, through the writer, the disk.
import { PaperNotesStore } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("idb", () => ({ openDB: async () => require("../../support/fakeIdb").fakeDb }));
jest.mock("../../../src/storage/libraryFileSystem", () => ({ createLibraryFileSystem: () => { throw new Error("the real library file system is not available in this test"); } }));

import { createLiveFiles, followLiveNotes, type LiveFiles } from "../../../src/localSync/liveFiles";
import { wrapLiveFileSystem } from "../../../src/localSync/liveFileSystem";
import { createPaperNotesPort } from "../../../src/storage/records";
import { clearFakeDb } from "../../support/fakeIdb";
import { Bus, Disk, FakeLock, FakeScheduler, LIB, NOTES, PAPER_ID, alwaysVisible, cachePaper, itemBodies, settle, textMerge, type Endpoint } from "./liveNotesFixtures";

interface Page { readonly live: LiveFiles; readonly channel: Endpoint }

describe("two pages over one notes.qmd", () => {
  let pages: Page[] = [];
  let follows: Array<{ release(): Promise<void> }> = [];

  beforeEach(() => { clearFakeDb(); cachePaper(); pages = []; follows = []; });
  afterEach(async () => {
    for (const followed of follows) { await followed.release().catch(() => undefined); }
    for (const { live } of pages) { await live.close().catch(() => undefined); }
  });

  function world() {
    const disk = new Disk();
    disk.seed(NOTES, "");
    const bus = new Bus();
    const lock = new FakeLock();
    const scheduler = new FakeScheduler();
    const page = (name: string): Page => {
      const channel = bus.endpoint();
      const live = createLiveFiles({
        libraryId: LIB, fs: disk.view(name), channel, lock, heldLocks: async () => lock.names(), visibility: alwaysVisible, textMerge,
        onConflict: jest.fn(), onError: jest.fn(), scheduler, peerWaitMs: 100, pollMs: 2000, persistDelayMs: 300,
      });
      const created = { live, channel };
      pages.push(created);
      return created;
    };
    return { disk, scheduler, page };
  }

  /** Page R follows the notes (the first holder, so it reads the disk); page N opens the same file and gets R's text. */
  async function setup() {
    const env = world();
    const r = env.page("R");
    const n = env.page("N");
    const onChange = jest.fn();
    const followed = followLiveNotes({ live: r.live, path: NOTES, onChange, scheduler: env.scheduler });
    follows.push(followed);
    await env.scheduler.advance(100);
    await settle();
    const nFile = n.live.open(NOTES);
    await settle();
    expect(await nFile.replica.ready).toBe("peer");
    await env.scheduler.advance(1000);
    onChange.mockClear();
    const store = new PaperNotesStore(createPaperNotesPort(wrapLiveFileSystem(env.disk.view("R"), async () => r.live)), { newId: () => "n-01JB2QN0000000000000000000", now: () => "2026-01-01T00:00:00Z" });
    return { env, onChange, nFile, store };
  }

  it("A2 a note written through page R's PaperNotesStore shows in page N's replica", async () => {
    const { env, nFile, store } = await setup();
    await store.addItem(PAPER_ID, { body: "note from R" });
    await settle();
    expect(nFile.replica.text()).toContain("note from R");
    // It reached the replica, not the disk: the writer persists it after its delay.
    expect(env.disk.writes).toEqual([]);
  });

  it("A2 the note written in R reaches the disk through the writer after the persist delay", async () => {
    const { env, store } = await setup();
    await store.addItem(PAPER_ID, { body: "note from R" });
    await env.scheduler.advance(300);
    expect(env.disk.text(NOTES)).toContain("note from R");
  });

  it("A2 an item body edited in page N's doc reaches R's onChange once and R's store read", async () => {
    const { env, onChange, nFile, store } = await setup();
    await store.addItem(PAPER_ID, { body: "note from R" });
    await env.scheduler.advance(1000);
    onChange.mockClear();
    nFile.replica.replace(nFile.replica.text().replace("note from R", "edited in N"));
    await env.scheduler.advance(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    const bodies = itemBodies(await store.read(PAPER_ID));
    expect(bodies.some((body) => body.includes("edited in N"))).toBe(true);
    expect(bodies.some((body) => body.includes("note from R"))).toBe(false);
  });

  it("A2 R's own write calls its onChange, so the notes are re-pushed", async () => {
    const { env, onChange, store } = await setup();
    await store.addItem(PAPER_ID, { body: "note from R" });
    await env.scheduler.advance(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
