// Pins createDiskWriters: one writer per file per page through a shared lock, queued pages taking over, observer or stat-poll watching, and bridge 'changed' hints.
import * as Y from "yjs";
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

import type { SessionScheduler } from "../../../src/collab/channel.js";
import { createDiskWriters, POLL_MS, writerLockName, type DiskWriters } from "../../../src/localSync/writer/diskWriters.js";
import type { FileStat, WriterFiles, WriterLock, WriterObserver, WriterReplica, WriterVisibility } from "../../../src/localSync/writer/ports.js";
import { createTextMerge } from "../../../src/writing/textMerge.js";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads (as mergeFile.test.ts does).
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;
const textMerge = createTextMerge(diff3Merge);

const LIB = "lib1";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---- Fakes

type OpKind = "read" | "stat" | "write";
interface Op { readonly page: string; readonly op: OpKind; readonly path: string }

/** In-memory files shared by every page; each page gets a view that tags its operations. */
class Disk {
  readonly events: string[];
  readonly ops: Op[] = [];
  private readonly files = new Map<string, { text: string; mtime: number }>();
  private tick = 1;

  constructor(events: string[]) { this.events = events; }

  seed(path: string, text: string): void { this.files.set(path, { text, mtime: ++this.tick }); }

  /** Another app saves the file: the stat changes. */
  external(path: string, text: string): void { this.files.set(path, { text, mtime: ++this.tick }); }

  /** Changes the text but keeps the stat, so only a forced sync can notice it. */
  silent(path: string, text: string): void {
    const file = this.files.get(path);
    if (!file || file.text.length !== text.length) { throw new Error("silent() needs an existing file and a same-length text"); }
    file.text = text;
  }

  text(path: string): string | undefined { return this.files.get(path)?.text; }

  count(filter: { page?: string; op?: OpKind; path?: string }): number {
    return this.ops.filter((o) => (filter.page === undefined || o.page === filter.page) && (filter.op === undefined || o.op === filter.op) && (filter.path === undefined || o.path === filter.path)).length;
  }

  view(page: string): WriterFiles {
    const file = (path: string) => {
      const found = this.files.get(path);
      if (!found) { throw new Error(`no such file: ${path}`); }
      return found;
    };
    return {
      read: async (path) => { this.ops.push({ page, op: "read", path }); return file(path).text; },
      stat: async (path): Promise<FileStat> => { this.ops.push({ page, op: "stat", path }); const f = file(path); return { lastModified: f.mtime, size: f.text.length }; },
      write: async (path, text) => {
        this.ops.push({ page, op: "write", path });
        this.events.push(`write:${path}`);
        this.files.set(path, { text, mtime: ++this.tick });
      },
    };
  }
}

interface LockRequest { readonly onGranted: () => void; done: boolean }
interface LockState { holder: LockRequest | null; queue: LockRequest[] }

/** One lock shared by every page: exclusive per name, FIFO, granted asynchronously. */
class FakeLock implements WriterLock {
  readonly requests: string[] = [];
  private readonly states = new Map<string, LockState>();
  private readonly events: string[];

  constructor(events: string[]) { this.events = events; }

  private state(name: string): LockState {
    let s = this.states.get(name);
    if (!s) { s = { holder: null, queue: [] }; this.states.set(name, s); }
    return s;
  }

  private pump(name: string): void {
    const s = this.state(name);
    if (s.holder || s.queue.length === 0) { return; }
    const req = s.queue.shift()!;
    s.holder = req;
    queueMicrotask(() => { if (s.holder === req && !req.done) { req.onGranted(); } });
  }

  request(name: string, onGranted: () => void): () => void {
    this.requests.push(name);
    const req: LockRequest = { onGranted, done: false };
    this.state(name).queue.push(req);
    this.pump(name);
    return () => {
      if (req.done) { return; }
      req.done = true;
      const s = this.state(name);
      const at = s.queue.indexOf(req);
      if (at >= 0) { s.queue.splice(at, 1); }
      if (s.holder === req) { s.holder = null; this.events.push(`release:${name}`); this.pump(name); }
    };
  }

  /** The holder's page vanished without stopping its writer: the host drops its lock. */
  forceRelease(name: string): void {
    const s = this.state(name);
    if (s.holder) { s.holder.done = true; s.holder = null; this.pump(name); }
  }

  held(name: string): boolean { return this.state(name).holder !== null; }

  queued(name: string): number { return this.state(name).queue.length; }
}

class FakeVisibility implements WriterVisibility {
  private shown = true;
  private readonly listeners = new Set<() => void>();
  visible(): boolean { return this.shown; }
  onVisible(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  listenerCount(): number { return this.listeners.size; }
  hide(): void { this.shown = false; }
  show(): void { this.shown = true; for (const l of [...this.listeners]) { l(); } }
}

class FakeObserver implements WriterObserver {
  readonly observed: string[] = [];
  private readonly watches: { path: string; onChange: () => void; active: boolean }[] = [];
  observe(path: string, onChange: () => void): () => void {
    this.observed.push(path);
    const watch = { path, onChange, active: true };
    this.watches.push(watch);
    return () => { watch.active = false; };
  }
  watching(): string[] { return this.watches.filter((w) => w.active).map((w) => w.path); }
  fire(path: string): void { for (const w of this.watches) { if (w.active && w.path === path) { w.onChange(); } } }
}

/** A manual clock: timers run only when advance() reaches them. */
class ManualClock implements SessionScheduler {
  private time = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  now(): number { return this.time; }

  after(ms: number, fn: () => void): () => void {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + ms, fn });
    return () => { this.timers.delete(id); };
  }

  pending(): number { return this.timers.size; }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort(([ia, a], [ib, b]) => a.at - b.at || ia - ib)[0];
      if (!due) { break; }
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].at);
      due[1].fn();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

type TestReplica = WriterReplica & { append(text: string): void };

/** A replica over a Y.Doc with one Y.Text, as the hub's text layout. */
function makeReplica(initial: string): TestReplica {
  const doc = new Y.Doc();
  const ytext = doc.getText("text");
  if (initial) { ytext.insert(0, initial); }
  return {
    doc,
    text: () => ytext.toString(),
    replace: (text, origin) => { doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, text); }, origin ?? null); },
    append: (text) => { doc.transact(() => { ytext.insert(ytext.length, text); }, "user"); },
  };
}

// ---- World and pages

interface World { readonly events: string[]; readonly disk: Disk; readonly lock: FakeLock; readonly clock: ManualClock }

function newWorld(files: Record<string, string> = {}): World {
  const events: string[] = [];
  const disk = new Disk(events);
  for (const [path, text] of Object.entries(files)) { disk.seed(path, text); }
  return { events, disk, lock: new FakeLock(events), clock: new ManualClock() };
}

interface Page {
  readonly name: string;
  readonly writers: DiskWriters;
  readonly visibility: FakeVisibility;
  readonly observer?: FakeObserver;
  readonly conflicts: [string, string][];
  readonly errors: unknown[];
}

function makePage(world: World, name: string, opts: { observer?: boolean; pollMs?: number; persistDelayMs?: number } = {}): Page {
  const visibility = new FakeVisibility();
  const observer = opts.observer ? new FakeObserver() : undefined;
  const conflicts: [string, string][] = [];
  const errors: unknown[] = [];
  const writers = createDiskWriters({
    libraryId: LIB,
    files: world.disk.view(name),
    lock: world.lock,
    visibility,
    ...(observer ? { observer } : {}),
    textMerge,
    scheduler: world.clock,
    ...(opts.pollMs !== undefined ? { pollMs: opts.pollMs } : {}),
    ...(opts.persistDelayMs !== undefined ? { persistDelayMs: opts.persistDelayMs } : {}),
    onConflict: (path, copyPath) => { conflicts.push([path, copyPath]); },
    onError: (error) => { errors.push(error); },
  });
  return { name, writers, visibility, ...(observer ? { observer } : {}), conflicts, errors };
}

const lockName = (path: string) => writerLockName(LIB, path);

describe("createDiskWriters", () => {
  it("2.2f names the lock labshelf:file:<libraryId>:<path>", async () => {
    expect(writerLockName("lib1", "chapters/a.tex")).toBe("labshelf:file:lib1:chapters/a.tex");
    const world = newWorld({ "chapters/a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("chapters/a.tex", makeReplica("hello\n"));
    await settle();
    expect(world.lock.requests).toEqual(["labshelf:file:lib1:chapters/a.tex"]);
  });

  it("2.2c exports a default poll interval of 2000 ms", () => {
    expect(POLL_MS).toBe(2000);
  });

  // ---- 2.2a: exactly one writer per file

  it("2.2a makes only the first of two pages the writer of a path", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    expect(p1.writers.isWriter("a.tex")).toBe(true);
    expect(p2.writers.isWriter("a.tex")).toBe(false);
    expect(world.lock.held(lockName("a.tex"))).toBe(true);
    expect(world.lock.queued(lockName("a.tex"))).toBe(1);
  });

  it("2.2a isWriter is false for a path never attached", () => {
    const p1 = makePage(newWorld(), "p1");
    expect(p1.writers.isWriter("nothing.tex")).toBe(false);
  });

  it("2.2a writes the file only from the page that holds the lock", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    r.append("more\n");
    await world.clock.advance(299);
    expect(world.disk.count({ op: "write" })).toBe(0);
    await world.clock.advance(1);
    expect(world.disk.text("a.tex")).toBe("hello\nmore\n");
    expect(world.disk.count({ page: "p1", op: "write" })).toBe(1);
    expect(world.disk.count({ page: "p2" })).toBe(0);
  });

  it("2.2a a queued page makes no read, stat or write of the file", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    p2.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    await world.clock.advance(10_000);
    expect(world.disk.count({ page: "p2" })).toBe(0);
  });

  it("2.2a requests the lock once per page for a path, however often it is attached", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", r);
    p1.writers.attach("a.tex", r);
    await settle();
    expect(world.lock.requests.filter((n) => n === lockName("a.tex"))).toHaveLength(1);
  });

  it("2.2a keeps a writer per path: another path is a separate lock and a separate writer", async () => {
    const world = newWorld({ "a.tex": "A\n", "b.tex": "B\n" });
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", makeReplica("A\n"));
    p2.writers.attach("a.tex", makeReplica("A\n"));
    p2.writers.attach("b.tex", makeReplica("B\n"));
    await settle();
    expect(p1.writers.isWriter("a.tex")).toBe(true);
    expect(p2.writers.isWriter("a.tex")).toBe(false);
    expect(p2.writers.isWriter("b.tex")).toBe(true);
    expect(world.lock.held(lockName("b.tex"))).toBe(true);
  });

  it("2.2a gives the writer it creates the persist delay of the options", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1", { persistDelayMs: 50 });
    p1.writers.attach("a.tex", r);
    await settle();
    r.append("more\n");
    await world.clock.advance(49);
    expect(world.disk.text("a.tex")).toBe("hello\n");
    await world.clock.advance(1);
    expect(world.disk.text("a.tex")).toBe("hello\nmore\n");
  });

  it("2.2a passes conflicts of the writer it creates to onConflict with the path and the copy path", async () => {
    const world = newWorld({ "a.txt": "one\ntwo\nthree\n" });
    const r = makeReplica("one\ntwo\nthree\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.txt", r);
    await settle();
    r.replace("one\nTWO-doc\nthree\n", "user");
    world.disk.external("a.txt", "one\nTWO-disk\nthree\n");
    p1.writers.changed("a.txt");
    await settle();
    await world.clock.advance(300);
    expect(p1.conflicts).toHaveLength(1);
    const [path, copyPath] = p1.conflicts[0]!;
    expect(path).toBe("a.txt");
    expect(copyPath).not.toBe("a.txt");
    expect(world.disk.text("a.txt")).toBe("one\nTWO-doc\nthree\n");
    expect(world.disk.text(copyPath)).toBe("one\nTWO-disk\nthree\n");
  });

  it("2.2a queues the pages in order: a third page waits behind the second", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    const p3 = makePage(world, "p3");
    const release1 = p1.writers.attach("a.tex", r);
    const release2 = p2.writers.attach("a.tex", r);
    p3.writers.attach("a.tex", r);
    await settle();
    expect([p1, p2, p3].map((p) => p.writers.isWriter("a.tex"))).toEqual([true, false, false]);
    await release1();
    await settle();
    expect([p1, p2, p3].map((p) => p.writers.isWriter("a.tex"))).toEqual([false, true, false]);
    await release2();
    await settle();
    expect([p1, p2, p3].map((p) => p.writers.isWriter("a.tex"))).toEqual([false, false, true]);
  });

  // ---- 2.2b: takeover

  it("2.2b makes the queued page the writer when the holder releases", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    const release1 = p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    await release1();
    await settle();
    expect(p1.writers.isWriter("a.tex")).toBe(false);
    expect(p2.writers.isWriter("a.tex")).toBe(true);
    r.append("after takeover\n");
    await world.clock.advance(300);
    expect(world.disk.text("a.tex")).toBe("hello\nafter takeover\n");
    expect(world.disk.count({ page: "p2", op: "write" })).toBe(1);
  });

  it("2.2b the new writer writes edits the old holder never wrote", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    r.append("unwritten edit\n");
    expect(world.disk.count({ page: "p1", op: "write" })).toBe(0);
    world.lock.forceRelease(lockName("a.tex"));
    await settle();
    expect(p2.writers.isWriter("a.tex")).toBe(true);
    expect(world.disk.text("a.tex")).toBe("hello\nunwritten edit\n");
    expect(world.disk.count({ page: "p2", op: "write" })).toBe(1);
  });

  it("2.2b makes the queued page the writer when the holder closes, with the holder's pending edit on disk", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    r.append("pending\n");
    await p1.writers.close();
    await settle();
    expect(world.disk.text("a.tex")).toBe("hello\npending\n");
    expect(p1.writers.isWriter("a.tex")).toBe(false);
    expect(p2.writers.isWriter("a.tex")).toBe(true);
    r.append("later\n");
    await world.clock.advance(300);
    expect(world.disk.text("a.tex")).toBe("hello\npending\nlater\n");
    expect(world.disk.count({ page: "p2", op: "write" })).toBeGreaterThanOrEqual(1);
  });

  it("2.2b the new writer starts watching: it takes in an outside change by its poll", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    const release1 = p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    await release1();
    await settle();
    world.disk.external("a.tex", "hello\nfrom vscode\n");
    await world.clock.advance(POLL_MS);
    expect(r.text()).toBe("hello\nfrom vscode\n");
  });

  // ---- 2.2c: stat poll without an observer

  it("2.2c stats the file every 2 s while visible, without reading it when unchanged", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    const stats = () => world.disk.count({ op: "stat", path: "a.tex" });
    const reads = () => world.disk.count({ op: "read", path: "a.tex" });
    const s0 = stats();
    const r0 = reads();
    await world.clock.advance(1999);
    expect(stats()).toBe(s0);
    await world.clock.advance(1);
    expect(stats()).toBe(s0 + 1);
    await world.clock.advance(2000);
    expect(stats()).toBe(s0 + 2);
    expect(reads()).toBe(r0);
  });

  it("2.2c polls every held writer from one page timer", async () => {
    const world = newWorld({ "a.tex": "A\n", "b.tex": "B\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("A\n"));
    p1.writers.attach("b.tex", makeReplica("B\n"));
    await settle();
    expect(world.clock.pending()).toBe(1);
    const a0 = world.disk.count({ op: "stat", path: "a.tex" });
    const b0 = world.disk.count({ op: "stat", path: "b.tex" });
    await world.clock.advance(POLL_MS);
    expect(world.disk.count({ op: "stat", path: "a.tex" })).toBe(a0 + 1);
    expect(world.disk.count({ op: "stat", path: "b.tex" })).toBe(b0 + 1);
  });

  it("2.2c honours the pollMs option", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1", { pollMs: 500 });
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    const s0 = world.disk.count({ op: "stat" });
    await world.clock.advance(499);
    expect(world.disk.count({ op: "stat" })).toBe(s0);
    await world.clock.advance(1);
    expect(world.disk.count({ op: "stat" })).toBe(s0 + 1);
  });

  it("2.2c merges an outside change into the doc when the poll finds the stat changed", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", r);
    await settle();
    world.disk.external("a.tex", "hello\nremote\n");
    await world.clock.advance(POLL_MS);
    expect(r.text()).toBe("hello\nremote\n");
    expect(world.disk.count({ op: "write" })).toBe(0);
  });

  it("2.2c does not stat while the page is hidden", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    const s0 = world.disk.count({ op: "stat" });
    p1.visibility.hide();
    await world.clock.advance(10_000);
    expect(world.disk.count({ op: "stat" })).toBe(s0);
  });

  it("2.2c checks every held writer at once when the page becomes visible", async () => {
    const world = newWorld({ "a.tex": "A\n", "b.tex": "B\n" });
    const ra = makeReplica("A\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", ra);
    p1.writers.attach("b.tex", makeReplica("B\n"));
    await settle();
    p1.visibility.hide();
    await world.clock.advance(5000);
    world.disk.external("a.tex", "A\nremote\n");
    const a0 = world.disk.count({ op: "stat", path: "a.tex" });
    const b0 = world.disk.count({ op: "stat", path: "b.tex" });
    p1.visibility.show();
    await settle();
    expect(world.disk.count({ op: "stat", path: "a.tex" })).toBeGreaterThanOrEqual(a0 + 1);
    expect(world.disk.count({ op: "stat", path: "b.tex" })).toBeGreaterThanOrEqual(b0 + 1);
    expect(ra.text()).toBe("A\nremote\n");
  });

  it("2.2c polls again once visible after having been hidden", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    p1.visibility.hide();
    await world.clock.advance(5000);
    p1.visibility.show();
    await settle();
    const s0 = world.disk.count({ op: "stat" });
    await world.clock.advance(POLL_MS);
    expect(world.disk.count({ op: "stat" })).toBeGreaterThanOrEqual(s0 + 1);
  });

  it("2.2c arms no timer while the page holds no writer", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    expect(world.clock.pending()).toBe(0);
    const release1 = p1.writers.attach("a.tex", r);
    await settle();
    expect(world.clock.pending()).toBe(1);
    const release2 = p2.writers.attach("a.tex", r);
    await settle();
    expect(world.clock.pending()).toBe(1);
    await release2();
    await release1();
    await settle();
    expect(world.clock.pending()).toBe(0);
  });

  it("2.2c does not poll on a page that only queues", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    p2.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    p2.visibility.hide();
    p2.visibility.show();
    await world.clock.advance(10_000);
    expect(world.disk.count({ page: "p2" })).toBe(0);
  });

  // ---- 2.2d: observer

  it("2.2d observes the path of a granted writer with the observer", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1", { observer: true });
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    expect(p1.observer!.watching()).toEqual(["a.tex"]);
  });

  it("2.2d does not poll when an observer is given", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1", { observer: true });
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    const s0 = world.disk.count({ op: "stat" });
    const r0 = world.disk.count({ op: "read" });
    await world.clock.advance(20_000);
    expect(world.disk.count({ op: "stat" })).toBe(s0);
    expect(world.disk.count({ op: "read" })).toBe(r0);
  });

  it("2.2d an observer event syncs the file even though its stat did not change", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1", { observer: true });
    p1.writers.attach("a.tex", r);
    await settle();
    world.disk.silent("a.tex", "jello\n");
    p1.observer!.fire("a.tex");
    await settle();
    expect(r.text()).toBe("jello\n");
  });

  it("2.2d an observer event for a file the doc also edited writes the merged text", async () => {
    const world = newWorld({ "a.tex": "one\n\ntwo\n\nthree\n" });
    const r = makeReplica("one\n\ntwo\n\nthree\n");
    const p1 = makePage(world, "p1", { observer: true });
    p1.writers.attach("a.tex", r);
    await settle();
    r.replace("ONE\n\ntwo\n\nthree\n", "user");
    world.disk.external("a.tex", "one\n\ntwo\n\nTHREE\n");
    p1.observer!.fire("a.tex");
    await settle();
    expect(world.disk.text("a.tex")).toBe("ONE\n\ntwo\n\nTHREE\n");
    expect(r.text()).toBe("ONE\n\ntwo\n\nTHREE\n");
  });

  it("2.2d stops the observation when the path is released", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1", { observer: true });
    const release = p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    await release();
    expect(p1.observer!.watching()).toEqual([]);
  });

  it("2.2d a queued page does not observe until it becomes the writer", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1", { observer: true });
    const p2 = makePage(world, "p2", { observer: true });
    const release1 = p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    expect(p2.observer!.watching()).toEqual([]);
    await release1();
    await settle();
    expect(p2.observer!.watching()).toEqual(["a.tex"]);
  });

  it("2.2d still checks the held writers at once when the page becomes visible", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1", { observer: true });
    p1.writers.attach("a.tex", r);
    await settle();
    p1.visibility.hide();
    world.disk.external("a.tex", "hello\nremote\n");
    const s0 = world.disk.count({ op: "stat" });
    p1.visibility.show();
    await settle();
    expect(world.disk.count({ op: "stat" })).toBeGreaterThanOrEqual(s0 + 1);
    expect(r.text()).toBe("hello\nremote\n");
  });

  // ---- 2.2e: changed hints

  it("2.2e changed syncs the file at once on the writer page", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", r);
    await settle();
    world.disk.silent("a.tex", "jello\n");
    p1.writers.changed("a.tex");
    await settle();
    expect(r.text()).toBe("jello\n");
  });

  it("2.2e changed syncs the file even while the page is hidden", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", r);
    await settle();
    p1.visibility.hide();
    world.disk.silent("a.tex", "jello\n");
    p1.writers.changed("a.tex");
    await settle();
    expect(r.text()).toBe("jello\n");
  });

  it("2.2e changed does nothing on a queued page", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.writers.attach("a.tex", r);
    p2.writers.attach("a.tex", r);
    await settle();
    world.disk.silent("a.tex", "jello\n");
    p2.writers.changed("a.tex");
    await settle();
    expect(world.disk.count({ page: "p2" })).toBe(0);
    expect(r.text()).toBe("hello\n");
  });

  it("2.2e changed does nothing for a path the page never attached", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    expect(() => p1.writers.changed("a.tex")).not.toThrow();
    await settle();
    expect(world.disk.count({})).toBe(0);
  });

  it("2.2e changed only syncs the path it names", async () => {
    const world = newWorld({ "a.tex": "A\n", "b.tex": "B\n" });
    const rb = makeReplica("B\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("A\n"));
    p1.writers.attach("b.tex", rb);
    await settle();
    world.disk.silent("b.tex", "C\n");
    p1.writers.changed("a.tex");
    await settle();
    expect(rb.text()).toBe("B\n");
  });

  // ---- 2.2f: refcount and cancel

  it("2.2f needs two releases after two attaches of the same path", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const release1 = p1.writers.attach("a.tex", r);
    const release2 = p1.writers.attach("a.tex", r);
    await settle();
    await release1();
    expect(p1.writers.isWriter("a.tex")).toBe(true);
    expect(world.lock.held(lockName("a.tex"))).toBe(true);
    r.append("still persisted\n");
    await world.clock.advance(300);
    expect(world.disk.text("a.tex")).toBe("hello\nstill persisted\n");
    await release2();
    expect(p1.writers.isWriter("a.tex")).toBe(false);
    expect(world.lock.held(lockName("a.tex"))).toBe(false);
  });

  it("2.2f a release called twice counts down once", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const release1 = p1.writers.attach("a.tex", r);
    p1.writers.attach("a.tex", r);
    await settle();
    await release1();
    await release1();
    expect(p1.writers.isWriter("a.tex")).toBe(true);
    expect(world.lock.held(lockName("a.tex"))).toBe(true);
  });

  it("2.2f throws when a path that is attached gets a different replica", () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    expect(() => p1.writers.attach("a.tex", makeReplica("hello\n"))).toThrow();
  });

  it("2.2f forgets a released path: it can be attached again with another replica and asks the lock anew", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    const release = p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    await release();
    expect(p1.writers.isWriter("a.tex")).toBe(false);
    const again = makeReplica("hello\n");
    expect(() => p1.writers.attach("a.tex", again)).not.toThrow();
    await settle();
    expect(p1.writers.isWriter("a.tex")).toBe(true);
    expect(world.lock.requests.filter((n) => n === lockName("a.tex"))).toHaveLength(2);
    again.append("new\n");
    await world.clock.advance(300);
    expect(world.disk.text("a.tex")).toBe("hello\nnew\n");
  });

  it("2.2f a release at zero flushes the pending edit before the lock is released", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const release = p1.writers.attach("a.tex", r);
    await settle();
    r.append("pending\n");
    await release();
    expect(world.disk.text("a.tex")).toBe("hello\npending\n");
    expect(world.lock.held(lockName("a.tex"))).toBe(false);
    const wrote = world.events.indexOf("write:a.tex");
    const released = world.events.indexOf(`release:${lockName("a.tex")}`);
    expect(wrote).toBeGreaterThanOrEqual(0);
    expect(released).toBeGreaterThan(wrote);
  });

  it("2.2f a release while queued cancels the request and no writer is ever created", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    const release1 = p1.writers.attach("a.tex", r);
    await settle();
    const release2 = p2.writers.attach("a.tex", r);
    await settle();
    expect(world.lock.queued(lockName("a.tex"))).toBe(1);
    await release2();
    expect(world.lock.queued(lockName("a.tex"))).toBe(0);
    expect(p2.writers.isWriter("a.tex")).toBe(false);
    await release1();
    await settle();
    expect(world.lock.held(lockName("a.tex"))).toBe(false);
    expect(p2.writers.isWriter("a.tex")).toBe(false);
    expect(world.disk.count({ page: "p2" })).toBe(0);
  });

  it("2.2f a release before the grant arrives cancels the request and no writer is created", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    const release = p1.writers.attach("a.tex", makeReplica("hello\n"));
    await release();
    await settle();
    expect(p1.writers.isWriter("a.tex")).toBe(false);
    expect(world.lock.held(lockName("a.tex"))).toBe(false);
    expect(world.lock.queued(lockName("a.tex"))).toBe(0);
    expect(world.disk.count({})).toBe(0);
    const p2 = makePage(world, "p2");
    p2.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    expect(p2.writers.isWriter("a.tex")).toBe(true);
  });

  it("2.2f one release of two attaches before the grant keeps the request", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const release1 = p1.writers.attach("a.tex", r);
    p1.writers.attach("a.tex", r);
    await release1();
    await settle();
    expect(p1.writers.isWriter("a.tex")).toBe(true);
  });

  // ---- 2.2g: close

  it("2.2g close flushes pending edits and releases every lock", async () => {
    const world = newWorld({ "a.tex": "A\n", "b.tex": "B\n", "c.tex": "C\n" });
    const ra = makeReplica("A\n");
    const rb = makeReplica("B\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p2.writers.attach("c.tex", makeReplica("C\n"));
    await settle();
    p1.writers.attach("a.tex", ra);
    p1.writers.attach("b.tex", rb);
    p1.writers.attach("c.tex", makeReplica("C\n"));
    await settle();
    ra.append("edit a\n");
    rb.append("edit b\n");
    await p1.writers.close();
    expect(world.disk.text("a.tex")).toBe("A\nedit a\n");
    expect(world.disk.text("b.tex")).toBe("B\nedit b\n");
    expect(world.lock.held(lockName("a.tex"))).toBe(false);
    expect(world.lock.held(lockName("b.tex"))).toBe(false);
    expect(world.lock.queued(lockName("c.tex"))).toBe(0);
    expect(world.lock.held(lockName("c.tex"))).toBe(true);
    expect(["a.tex", "b.tex", "c.tex"].map((p) => p1.writers.isWriter(p))).toEqual([false, false, false]);
  });

  it("2.2g close writes before it releases the lock", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", r);
    await settle();
    r.append("pending\n");
    await p1.writers.close();
    const wrote = world.events.indexOf("write:a.tex");
    const released = world.events.indexOf(`release:${lockName("a.tex")}`);
    expect(wrote).toBeGreaterThanOrEqual(0);
    expect(released).toBeGreaterThan(wrote);
  });

  it("2.2g close stops the poll timer and the visibility listener", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await settle();
    await p1.writers.close();
    expect(world.clock.pending()).toBe(0);
    expect(p1.visibility.listenerCount()).toBe(0);
    const ops = world.disk.count({});
    p1.visibility.show();
    await world.clock.advance(10_000);
    expect(world.disk.count({})).toBe(ops);
  });

  it("2.2g close cancels a lock request that was not granted yet", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.writers.attach("a.tex", makeReplica("hello\n"));
    await p1.writers.close();
    await settle();
    expect(world.lock.held(lockName("a.tex"))).toBe(false);
    expect(world.lock.queued(lockName("a.tex"))).toBe(0);
    expect(p1.writers.isWriter("a.tex")).toBe(false);
  });

  it("2.2g throws on attach after close", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    await p1.writers.close();
    expect(() => p1.writers.attach("a.tex", makeReplica("hello\n"))).toThrow();
  });
});
