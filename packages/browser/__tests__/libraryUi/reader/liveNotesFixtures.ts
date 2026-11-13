// Fakes the live-notes tests share: a manual clock, an in-memory library file system with a disk behind it, a message bus between pages and a lock.
import {
  createTextMerge,
  type LibraryFileSystem, type LocalStat, type PaperRecord, type ReplicaChannel, type ReplicaMessage, type SessionScheduler, type WriterLock,
} from "@labshelf/core";
import { fakeRows } from "../../support/fakeIdb";

export const { diff3Merge } = require("node-diff3") as { diff3Merge: Parameters<typeof createTextMerge>[0] };
export const textMerge = createTextMerge(diff3Merge);

export const LIB = "lib1";
export const PAPER_ID = "smith2020";
export const PAPER_DIR = "papers/smith2020";
export const NOTES = `${PAPER_DIR}/notes.qmd`;
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); }
};

export function cachePaper(): void {
  const record = { id: PAPER_ID, title: "Smith", path: PAPER_DIR, citeKey: "smith2020", status: "unread" } as unknown as PaperRecord;
  fakeRows.metadata.set(PAPER_ID, { paperId: PAPER_ID, record, folderPath: PAPER_DIR });
}

// ---- Fakes

/** A manual clock: timers run only when a test advances it, one at a time with the microtasks settled between. */
export class FakeScheduler implements SessionScheduler {
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

export const enoent = (path: string) => Object.assign(new Error(`${path} not found`), { code: "ENOENT" });

/** An in-memory library file system that records which methods were called. */
export class MemFs {
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

export interface Write { readonly page: string; readonly path: string; readonly text: string }

/** One in-memory disk; each page gets a view that tags its writes. */
export class Disk {
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

export type Endpoint = ReplicaChannel & { close(): void; closed: boolean };

/** One message bus for every page: a page's posts reach every other open endpoint a microtask later. */
export class Bus {
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

export interface LockRequest { readonly onGranted: () => void; done: boolean }

/** An exclusive FIFO lock shared by every page, granted a microtask after it is free. */
export class FakeLock implements WriterLock {
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

export const alwaysVisible = { visible: () => true, onVisible: () => () => undefined };

export const itemBodies = (file: ItemFile): string[] => file.segments.flatMap((segment) => (segment.kind === "item" ? [segment.body] : []));

// ---- 4.3a: the records ports
