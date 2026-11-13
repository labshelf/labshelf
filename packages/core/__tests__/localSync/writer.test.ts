// Pins DiskWriters.flush(path): the writer page persists the pending doc text at once; a path not attached, or whose lock is not granted, writes nothing.
import * as Y from "yjs";
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

import type { SessionScheduler } from "../../src/collab/channel.js";
import { createDiskWriters, writerLockName, type DiskWriters } from "../../src/localSync/writer/diskWriters.js";
import type { FileStat, WriterFiles, WriterLock, WriterReplica, WriterVisibility } from "../../src/localSync/writer/ports.js";
import { createTextMerge } from "../../src/writing/textMerge.js";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads (as mergeFile.test.ts does).
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;
const textMerge = createTextMerge(diff3Merge);

const LIB = "lib1";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---- Fakes

class Disk {
  readonly writes: { page: string; path: string; text: string }[] = [];
  private readonly files = new Map<string, { text: string; mtime: number }>();
  private tick = 1;
  seed(path: string, text: string): void { this.files.set(path, { text, mtime: ++this.tick }); }
  text(path: string): string | undefined { return this.files.get(path)?.text; }
  writesBy(page: string): number { return this.writes.filter((w) => w.page === page).length; }
  view(page: string): WriterFiles {
    const file = (path: string) => {
      const found = this.files.get(path);
      if (!found) { throw new Error(`no such file: ${path}`); }
      return found;
    };
    return {
      read: async (path) => file(path).text,
      stat: async (path): Promise<FileStat> => { const f = file(path); return { lastModified: f.mtime, size: f.text.length }; },
      write: async (path, text) => { this.writes.push({ page, path, text }); this.files.set(path, { text, mtime: ++this.tick }); },
    };
  }
}

interface LockRequest { readonly onGranted: () => void; done: boolean }
interface LockState { holder: LockRequest | null; queue: LockRequest[] }

/** One lock shared by every page: exclusive per name, FIFO, granted asynchronously. */
class FakeLock implements WriterLock {
  private readonly states = new Map<string, LockState>();
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
    const req: LockRequest = { onGranted, done: false };
    this.state(name).queue.push(req);
    this.pump(name);
    return () => {
      if (req.done) { return; }
      req.done = true;
      const s = this.state(name);
      const at = s.queue.indexOf(req);
      if (at >= 0) { s.queue.splice(at, 1); }
      if (s.holder === req) { s.holder = null; this.pump(name); }
    };
  }
}

class FakeVisibility implements WriterVisibility {
  visible(): boolean { return true; }
  onVisible(): () => void { return () => undefined; }
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

interface World { readonly disk: Disk; readonly lock: FakeLock; readonly clock: ManualClock; readonly errors: unknown[] }

function newWorld(files: Record<string, string> = {}): World {
  const disk = new Disk();
  for (const [path, text] of Object.entries(files)) { disk.seed(path, text); }
  return { disk, lock: new FakeLock(), clock: new ManualClock(), errors: [] };
}

function makePage(world: World, name: string): DiskWriters {
  return createDiskWriters({
    libraryId: LIB,
    files: world.disk.view(name),
    lock: world.lock,
    visibility: new FakeVisibility(),
    textMerge,
    scheduler: world.clock,
    onError: (error) => { world.errors.push(error); },
  });
}

describe("DiskWriters.flush", () => {
  it("3.1a writes the pending doc text on the writer page before the persist delay", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.attach("a.tex", r);
    await settle();
    expect(p1.isWriter("a.tex")).toBe(true);
    r.append("more\n");
    expect(world.disk.text("a.tex")).toBe("hello\n");
    await world.clock.advance(100);
    expect(world.disk.text("a.tex")).toBe("hello\n");
    await p1.flush("a.tex");
    expect(world.disk.text("a.tex")).toBe("hello\nmore\n");
    expect(world.disk.writesBy("p1")).toBe(1);
    expect(world.errors).toEqual([]);
  });

  it("3.1a a flush that wrote leaves nothing for the persist delay to write again", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.attach("a.tex", r);
    await settle();
    r.append("more\n");
    await p1.flush("a.tex");
    await world.clock.advance(1000);
    expect(world.disk.writesBy("p1")).toBe(1);
    expect(world.disk.text("a.tex")).toBe("hello\nmore\n");
  });

  it("3.1a flush with nothing pending writes nothing", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const p1 = makePage(world, "p1");
    p1.attach("a.tex", makeReplica("hello\n"));
    await settle();
    await p1.flush("a.tex");
    expect(world.disk.writes).toEqual([]);
  });

  it("3.1a flush on a path that is not attached resolves without a write", async () => {
    const world = newWorld({ "a.tex": "hello\n", "b.tex": "B\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.attach("a.tex", r);
    await settle();
    r.append("more\n");
    await expect(p1.flush("b.tex")).resolves.toBeUndefined();
    await expect(p1.flush("never.tex")).resolves.toBeUndefined();
    expect(world.disk.writes).toEqual([]);
    expect(world.disk.text("a.tex")).toBe("hello\n");
    expect(world.errors).toEqual([]);
  });

  it("3.1a flush on a page that waits for the lock resolves without a write", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r1 = makeReplica("hello\n");
    const r2 = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    const p2 = makePage(world, "p2");
    p1.attach("a.tex", r1);
    p2.attach("a.tex", r2);
    await settle();
    expect(p2.isWriter("a.tex")).toBe(false);
    r2.append("queued\n");
    await expect(p2.flush("a.tex")).resolves.toBeUndefined();
    expect(world.disk.writes).toEqual([]);
    expect(world.disk.text("a.tex")).toBe("hello\n");
    expect(world.errors).toEqual([]);
  });

  it("3.1a flush right after attach, before the lock is granted, resolves without a write", async () => {
    const world = newWorld({ "a.tex": "hello\n" });
    const r = makeReplica("hello\n");
    const p1 = makePage(world, "p1");
    p1.attach("a.tex", r);
    r.append("more\n");
    await expect(p1.flush("a.tex")).resolves.toBeUndefined();
    expect(world.disk.writes).toEqual([]);
  });

  it("3.1a flush of one path writes only that path", async () => {
    const world = newWorld({ "a.tex": "A\n", "b.tex": "B\n" });
    const ra = makeReplica("A\n");
    const rb = makeReplica("B\n");
    const p1 = makePage(world, "p1");
    p1.attach("a.tex", ra);
    p1.attach("b.tex", rb);
    await settle();
    ra.append("a2\n");
    rb.append("b2\n");
    await p1.flush("a.tex");
    expect(world.disk.text("a.tex")).toBe("A\na2\n");
    expect(world.disk.text("b.tex")).toBe("B\n");
    expect(writerLockName(LIB, "a.tex")).toBe("labshelf:file:lib1:a.tex");
  });
});
