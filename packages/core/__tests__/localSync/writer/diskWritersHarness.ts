// Fakes and builders shared by the diskWriters tests: an in-memory disk, a fake lock, visibility, observer and clock, and the page world.
import * as Y from "yjs";
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

import type { SessionScheduler } from "../../../src/collab/channel.js";
import { createDiskWriters, writerLockName, type DiskWriters } from "../../../src/localSync/writer/diskWriters.js";
import type { FileStat, WriterFiles, WriterLock, WriterObserver, WriterReplica, WriterVisibility } from "../../../src/localSync/writer/ports.js";
import { createTextMerge } from "../../../src/writing/textMerge.js";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads (as mergeFile.test.ts does).
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;
const textMerge = createTextMerge(diff3Merge);

const LIB = "lib1";
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---- Fakes

export type OpKind = "read" | "stat" | "write";
export interface Op { readonly page: string; readonly op: OpKind; readonly path: string }

/** In-memory files shared by every page; each page gets a view that tags its operations. */
export class Disk {
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

export interface LockRequest { readonly onGranted: () => void; done: boolean }
export interface LockState { holder: LockRequest | null; queue: LockRequest[] }

/** One lock shared by every page: exclusive per name, FIFO, granted asynchronously. */
export class FakeLock implements WriterLock {
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

export class FakeVisibility implements WriterVisibility {
  private shown = true;
  private readonly listeners = new Set<() => void>();
  visible(): boolean { return this.shown; }
  onVisible(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  listenerCount(): number { return this.listeners.size; }
  hide(): void { this.shown = false; }
  show(): void { this.shown = true; for (const l of [...this.listeners]) { l(); } }
}

export class FakeObserver implements WriterObserver {
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
export class ManualClock implements SessionScheduler {
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

export type TestReplica = WriterReplica & { append(text: string): void };

/** A replica over a Y.Doc with one Y.Text, as the hub's text layout. */
export function makeReplica(initial: string): TestReplica {
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

export interface World { readonly events: string[]; readonly disk: Disk; readonly lock: FakeLock; readonly clock: ManualClock }

export function newWorld(files: Record<string, string> = {}): World {
  const events: string[] = [];
  const disk = new Disk(events);
  for (const [path, text] of Object.entries(files)) { disk.seed(path, text); }
  return { events, disk, lock: new FakeLock(events), clock: new ManualClock() };
}

export interface Page {
  readonly name: string;
  readonly writers: DiskWriters;
  readonly visibility: FakeVisibility;
  readonly observer?: FakeObserver;
  readonly conflicts: [string, string][];
  readonly errors: unknown[];
}

export function makePage(world: World, name: string, opts: { observer?: boolean; pollMs?: number; persistDelayMs?: number } = {}): Page {
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

export const lockName = (path: string) => writerLockName(LIB, path);
