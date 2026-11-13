// Pins the browser reader's live paper notes: the paper notes port goes through readText/writeText (so the D5 wrapper routes it into a live replica), and followLiveNotes holds the notes.qmd replica and reports bursts of changes.
import {
  createReplicaHub, PaperNotesStore, createTextMerge,
  type ItemFile, type LibraryFileSystem, type LocalStat, type PaperRecord, type Replica, type ReplicaChannel, type ReplicaMessage, type SessionScheduler, type WriterLock,
} from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("idb", () => ({ openDB: async () => require("../../support/fakeIdb").fakeDb }));
jest.mock("../../../src/storage/libraryFileSystem", () => ({ createLibraryFileSystem: () => { throw new Error("the real library file system is not available in this test"); } }));

import { createLiveFiles, type LiveFiles } from "../../../src/localSync/liveFiles";
import { wrapLiveFileSystem } from "../../../src/localSync/liveFileSystem";
import { createPaperNotesPort, createSidecarPort } from "../../../src/storage/records";
import { followLiveNotes } from "../../../src/libraryUi/reader/liveNotes";
import { clearFakeDb, fakeRows } from "../../support/fakeIdb";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads.
const { diff3Merge } = require("node-diff3") as { diff3Merge: Parameters<typeof createTextMerge>[0] };
const textMerge = createTextMerge(diff3Merge);

const LIB = "lib1";
const PAPER_ID = "smith2020";
const PAPER_DIR = "papers/smith2020";
const NOTES = `${PAPER_DIR}/notes.qmd`;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); }
};

function cachePaper(): void {
  const record = { id: PAPER_ID, title: "Smith", path: PAPER_DIR, citeKey: "smith2020", status: "unread" } as unknown as PaperRecord;
  fakeRows.metadata.set(PAPER_ID, { paperId: PAPER_ID, record, folderPath: PAPER_DIR });
}

// ---- Fakes

/** A manual clock: timers run only when a test advances it, one at a time with the microtasks settled between. */
class FakeScheduler implements SessionScheduler {
  private time = 0;
  private nextId = 1;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];

  now(): number { return this.time; }

  after(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, fn });
    return () => { this.timers = this.timers.filter((timer) => timer.id !== id); };
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await settle();
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) { break; }
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.time = Math.max(this.time, due.at);
      due.fn();
      await settle();
    }
    this.time = target;
  }
}

const enoent = (path: string) => Object.assign(new Error(`${path} not found`), { code: "ENOENT" });

/** An in-memory library file system that records which methods were called. */
class MemFs {
  readonly calls: string[] = [];
  readonly files = new Map<string, string>();

  seed(path: string, text: string): void { this.files.set(path, text); }

  get fs(): LibraryFileSystem {
    const text = (path: string): string => {
      const found = this.files.get(path);
      if (found === undefined) { throw enoent(path); }
      return found;
    };
    const call = (name: string): void => { this.calls.push(name); };
    return {
      readText: async (path) => { call("readText"); return text(path); },
      writeText: async (path, content) => { call("writeText"); this.files.set(path, content); },
      readFile: async (path) => { call("readFile"); return new TextEncoder().encode(text(path)); },
      writeFile: async (path, bytes) => { call("writeFile"); this.files.set(path, new TextDecoder().decode(bytes)); },
      stat: async (path): Promise<LocalStat | undefined> => {
        call("stat");
        const found = this.files.get(path);
        return found === undefined ? undefined : { isFile: true, isDirectory: false, mtimeMs: 1, size: found.length };
      },
      exists: async (path) => this.files.has(path),
      listDir: async () => [],
      deleteFile: async (path) => { this.files.delete(path); },
      ensureDir: async () => undefined,
      mkdir: async () => undefined,
      rename: async () => undefined,
      trash: async () => undefined,
      removeTree: async () => undefined,
    };
  }
}

interface Write { readonly page: string; readonly path: string; readonly text: string }

/** One in-memory disk; each page gets a view that tags its writes. */
class Disk {
  readonly writes: Write[] = [];
  private readonly files = new Map<string, { text: string; mtime: number }>();
  private tick = 1;

  seed(path: string, text: string): void { this.files.set(path, { text, mtime: ++this.tick }); }

  text(path: string): string | undefined { return this.files.get(path)?.text; }

  view(page: string): LibraryFileSystem {
    const file = (path: string) => {
      const found = this.files.get(path);
      if (!found) { throw enoent(path); }
      return found;
    };
    return {
      readText: async (path) => file(path).text,
      writeText: async (path, text) => { this.writes.push({ page, path, text }); this.files.set(path, { text, mtime: ++this.tick }); },
      readFile: async (path) => new TextEncoder().encode(file(path).text),
      writeFile: async (path, bytes) => { this.writes.push({ page, path, text: new TextDecoder().decode(bytes) }); this.files.set(path, { text: new TextDecoder().decode(bytes), mtime: ++this.tick }); },
      stat: async (path): Promise<LocalStat | undefined> => {
        const found = this.files.get(path);
        return found ? { isFile: true, isDirectory: false, mtimeMs: found.mtime, size: found.text.length } : undefined;
      },
      exists: async (path) => this.files.has(path),
      listDir: async () => [],
      deleteFile: async (path) => { this.files.delete(path); },
      ensureDir: async () => undefined,
      mkdir: async () => undefined,
      rename: async () => undefined,
      trash: async () => undefined,
      removeTree: async () => undefined,
    };
  }
}

type Endpoint = ReplicaChannel & { close(): void; closed: boolean };

/** One message bus for every page: a page's posts reach every other open endpoint a microtask later. */
class Bus {
  private readonly endpoints = new Set<{ listeners: Set<(message: ReplicaMessage) => void>; closed: boolean }>();

  endpoint(): Endpoint {
    const self = { listeners: new Set<(message: ReplicaMessage) => void>(), closed: false };
    this.endpoints.add(self);
    return {
      get closed() { return self.closed; },
      post: (message) => {
        for (const other of this.endpoints) {
          if (other === self || other.closed) { continue; }
          const copy: ReplicaMessage = { ...message, bytes: new Uint8Array(message.bytes) };
          queueMicrotask(() => { if (!other.closed) { for (const listener of [...other.listeners]) { listener(copy); } } });
        }
      },
      onMessage: (listener) => { self.listeners.add(listener); return () => { self.listeners.delete(listener); }; },
      close: () => { self.closed = true; self.listeners.clear(); },
    };
  }
}

interface LockRequest { readonly onGranted: () => void; done: boolean }

/** An exclusive FIFO lock shared by every page, granted a microtask after it is free. */
class FakeLock implements WriterLock {
  private readonly holders = new Map<string, LockRequest>();
  private readonly queues = new Map<string, LockRequest[]>();

  private pump(name: string): void {
    if (this.holders.has(name)) { return; }
    const next = this.queues.get(name)?.shift();
    if (!next) { return; }
    this.holders.set(name, next);
    queueMicrotask(() => { if (this.holders.get(name) === next && !next.done) { next.onGranted(); } });
  }

  request(name: string, onGranted: () => void): () => void {
    const request: LockRequest = { onGranted, done: false };
    const queue = this.queues.get(name) ?? [];
    this.queues.set(name, queue);
    queue.push(request);
    this.pump(name);
    return () => {
      if (request.done) { return; }
      request.done = true;
      const at = queue.indexOf(request);
      if (at >= 0) { queue.splice(at, 1); }
      if (this.holders.get(name) === request) { this.holders.delete(name); this.pump(name); }
    };
  }

  names(): string[] {
    return [...new Set([...this.holders.keys(), ...[...this.queues].filter(([, queue]) => queue.length > 0).map(([name]) => name)])];
  }
}

const alwaysVisible = { visible: () => true, onVisible: () => () => undefined };

const itemBodies = (file: ItemFile): string[] => file.segments.flatMap((segment) => (segment.kind === "item" ? [segment.body] : []));

// ---- 4.3a: the records ports

describe("createPaperNotesPort", () => {
  beforeEach(() => { clearFakeDb(); cachePaper(); });

  it("4.3a reads the paper's notes.qmd through readText", async () => {
    const mem = new MemFs();
    mem.seed(NOTES, "some notes\n");
    const port = createPaperNotesPort(mem.fs);
    expect(await port.read(PAPER_ID)).toBe("some notes\n");
    expect(mem.calls).toContain("readText");
    expect(mem.calls).not.toContain("readFile");
  });

  it("4.3a writes the paper's notes.qmd through writeText at the paper folder", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    await port.write(PAPER_ID, "written notes\n");
    expect(mem.files.get(NOTES)).toBe("written notes\n");
    expect(mem.calls).toContain("writeText");
    expect(mem.calls).not.toContain("writeFile");
  });

  it("4.3a a paper without a notes.qmd reads null", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    expect(await port.read(PAPER_ID)).toBeNull();
  });

  it("4.3a a paper the library does not hold reads null", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    expect(await port.read("nobody")).toBeNull();
  });

  it("4.3a a note written through the port reads back through it", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    await port.write(PAPER_ID, "round trip\n");
    expect(await port.read(PAPER_ID)).toBe("round trip\n");
  });

  it("4.3a a wrapped file system routes the notes port's write into the live file", async () => {
    const written: Array<{ path: string; text: string }> = [];
    const mem = new MemFs();
    const live = {
      write: async (path: string, text: string) => { written.push({ path, text }); return true; },
      read: async (path: string) => (path === NOTES ? "live text" : undefined),
    } as unknown as LiveFiles;
    const port = createPaperNotesPort(wrapLiveFileSystem(mem.fs, async () => live));
    await port.write(PAPER_ID, "to the replica");
    expect(written).toEqual([{ path: NOTES, text: "to the replica" }]);
    expect(mem.files.has(NOTES)).toBe(false);
    expect(await port.read(PAPER_ID)).toBe("live text");
  });
});

describe("createSidecarPort", () => {
  it("4.3a still reads and writes data.json through stat, readFile and writeFile", async () => {
    const mem = new MemFs();
    const port = createSidecarPort(mem.fs);
    expect(await port.read("abc")).toBeNull();
    await port.write("abc", "{\"theme\":\"dark\"}");
    expect(mem.files.get(".research/papers/abc/data.json")).toBe("{\"theme\":\"dark\"}");
    expect(await port.read("abc")).toBe("{\"theme\":\"dark\"}");
    expect(mem.calls).toContain("readFile");
    expect(mem.calls).toContain("writeFile");
    expect(mem.calls).not.toContain("readText");
    expect(mem.calls).not.toContain("writeText");
  });
});

// ---- 4.3b: followLiveNotes over a fake LiveFiles holding a real replica

interface Follow {
  readonly scheduler: FakeScheduler;
  readonly replica: Replica;
  readonly open: jest.Mock;
  readonly flush: jest.Mock;
  readonly release: jest.Mock;
  readonly order: string[];
  readonly live: LiveFiles;
  /** Lets the pending disk read finish; a rejecting world fails it instead. */
  finishDisk(): void;
  failDisk(error: unknown): void;
}

/** A LiveFiles whose one file is a real replica; its disk read stays pending until the test finishes it. */
function followWorld(options: { flushGate?: Promise<void> } = {}): Follow {
  const scheduler = new FakeScheduler();
  const channel: ReplicaChannel = { post: () => undefined, onMessage: () => () => undefined };
  const hub = createReplicaHub({ channel, scheduler, peerWaitMs: 100, pageId: "R" });
  let finishDisk!: () => void;
  let failDisk!: (error: unknown) => void;
  const disk = new Promise<string>((resolve, reject) => { finishDisk = () => resolve("initial\n"); failDisk = reject; });
  const order: string[] = [];
  const flush = jest.fn(async () => { order.push("flush"); await options.flushGate; order.push("flushed"); });
  const release = jest.fn(async () => { order.push("release"); });
  let replica: Replica | undefined;
  const open = jest.fn((path: string) => {
    replica = hub.open(path, "qmd", () => disk);
    return { replica, flush, release };
  });
  const live = { libraryId: LIB, open, isLive: async () => true, write: async () => true, read: async () => undefined, changed: () => undefined, close: async () => undefined } as unknown as LiveFiles;
  const world = { scheduler, open, flush, release, order, live, finishDisk: () => finishDisk(), failDisk: (error: unknown) => failDisk(error) };
  Object.defineProperty(world, "replica", { get: () => replica });
  return world as unknown as Follow;
}

describe("followLiveNotes", () => {
  let follow: { release(): Promise<void> } | undefined;
  afterEach(async () => {
    await follow?.release().catch(() => undefined);
    follow = undefined;
  });

  /** Opens the file, lets the peer wait pass and the disk read finish: the replica is ready. */
  async function ready(world: Follow, onChange: () => void, delayMs?: number) {
    follow = followLiveNotes({ live: world.live, path: NOTES, onChange, scheduler: world.scheduler, ...(delayMs !== undefined ? { delayMs } : {}) });
    await world.scheduler.advance(100);
    world.finishDisk();
    await world.replica.ready;
    await world.scheduler.advance(1000);
    return follow;
  }

  it("4.3b opens the notes path of the live files once and holds it", async () => {
    const world = followWorld();
    await ready(world, jest.fn());
    expect(world.open).toHaveBeenCalledTimes(1);
    expect(world.open).toHaveBeenCalledWith(NOTES);
    expect(world.release).not.toHaveBeenCalled();
  });

  it("4.3b never calls onChange while the replica is not ready", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    follow = followLiveNotes({ live: world.live, path: NOTES, onChange, scheduler: world.scheduler });
    await world.scheduler.advance(100);
    // The peer wait has passed, the disk read is still pending: the replica is not ready.
    world.replica.doc.getText("probe").insert(0, "before ready");
    await world.scheduler.advance(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("4.3b does not call onChange for the text the replica starts from", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    await ready(world, onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("4.3b one doc update after ready calls onChange once, after the default 100 ms", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    await ready(world, onChange);
    world.replica.replace("edited\n");
    await world.scheduler.advance(99);
    expect(onChange).not.toHaveBeenCalled();
    await world.scheduler.advance(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    await world.scheduler.advance(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("4.3b a burst of doc updates calls onChange once", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    await ready(world, onChange);
    world.replica.replace("one\n");
    await world.scheduler.advance(20);
    world.replica.replace("two\n");
    await world.scheduler.advance(20);
    world.replica.replace("three\n");
    await world.scheduler.advance(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("4.3b two bursts far apart call onChange twice", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    await ready(world, onChange);
    world.replica.replace("first burst\n");
    await world.scheduler.advance(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    world.replica.replace("second burst\n");
    await world.scheduler.advance(1000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("4.3b delayMs sets the debounce", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    await ready(world, onChange, 250);
    world.replica.replace("edited\n");
    await world.scheduler.advance(249);
    expect(onChange).not.toHaveBeenCalled();
    await world.scheduler.advance(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("4.3b release flushes the live file, then releases it once", async () => {
    const world = followWorld();
    const followed = await ready(world, jest.fn());
    await followed.release();
    follow = undefined;
    expect(world.order).toEqual(["flush", "flushed", "release"]);
    expect(world.flush).toHaveBeenCalledTimes(1);
    expect(world.release).toHaveBeenCalledTimes(1);
  });

  it("4.3b release waits for the flush before it releases", async () => {
    let finishFlush!: () => void;
    const world = followWorld({ flushGate: new Promise<void>((resolve) => { finishFlush = resolve; }) });
    const followed = await ready(world, jest.fn());
    const released = followed.release();
    follow = undefined;
    await settle();
    expect(world.release).not.toHaveBeenCalled();
    finishFlush();
    await released;
    expect(world.order).toEqual(["flush", "flushed", "release"]);
  });

  it("4.3b release stops a pending onChange", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    const followed = await ready(world, onChange);
    world.replica.replace("edited\n");
    await world.scheduler.advance(50);
    await followed.release();
    follow = undefined;
    await world.scheduler.advance(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("4.3b a replica whose ready rejects never calls onChange and release still releases", async () => {
    const world = followWorld();
    const onChange = jest.fn();
    follow = followLiveNotes({ live: world.live, path: NOTES, onChange, scheduler: world.scheduler });
    await world.scheduler.advance(100);
    world.failDisk(new Error("disk unreadable"));
    await settle();
    await world.scheduler.advance(1000);
    expect(onChange).not.toHaveBeenCalled();
    await follow.release();
    follow = undefined;
    expect(world.release).toHaveBeenCalledTimes(1);
  });
});

// ---- A2: two pages over one notes.qmd

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
