// Pins createLiveFiles: two pages over one fake channel, one fake lock manager and one fake disk; the page that holds a file's lock writes it, a programmatic write to a live file goes into its replica, and an outside change that overlaps an unsaved edit makes a conflict copy.
import { createTextMerge, writerLockName, type LibraryFileSystem, type LocalStat, type ReplicaChannel, type ReplicaMessage, type SessionScheduler, type WriterLock } from "@labshelf/core";
import { createLiveFiles, type LiveFiles } from "../../src/localSync/liveFiles";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads.
const { diff3Merge } = require("node-diff3") as { diff3Merge: Parameters<typeof createTextMerge>[0] };
const textMerge = createTextMerge(diff3Merge);

const LIB = "lib1";
const PATH = "projects/p/main.tex";
const OTHER = "projects/p/other.tex";
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); }
};

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

interface Write { readonly page: string; readonly path: string; readonly text: string }

/** One in-memory disk; each page gets a view that tags its writes. */
class Disk {
  readonly writes: Write[] = [];
  private readonly files = new Map<string, { text: string; mtime: number }>();
  private tick = 1;

  seed(path: string, text: string): void { this.files.set(path, { text, mtime: ++this.tick }); }

  /** Another app saves the file. */
  external(path: string, text: string): void { this.files.set(path, { text, mtime: ++this.tick }); }

  text(path: string): string | undefined { return this.files.get(path)?.text; }

  paths(): string[] { return [...this.files.keys()]; }

  view(page: string): LibraryFileSystem {
    const file = (path: string) => {
      const found = this.files.get(path);
      if (!found) { throw Object.assign(new Error(`${path} not found`), { code: "ENOENT" }); }
      return found;
    };
    const fs: LibraryFileSystem = {
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
    return fs;
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
  readonly requests: string[] = [];
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
    this.requests.push(name);
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

  /** The names held or waited for, as navigator.locks.query() lists them. */
  names(): string[] {
    return [...new Set([...this.holders.keys(), ...[...this.queues].filter(([, queue]) => queue.length > 0).map(([name]) => name)])];
  }
}

const alwaysVisible = { visible: () => true, onVisible: () => () => undefined };

interface Page { readonly live: LiveFiles; readonly channel: Endpoint; readonly onConflict: jest.Mock; readonly onError: jest.Mock }

function world(files: Record<string, string> = { [PATH]: "hello", [OTHER]: "other" }) {
  const disk = new Disk();
  for (const [path, text] of Object.entries(files)) { disk.seed(path, text); }
  const bus = new Bus();
  const lock = new FakeLock();
  const scheduler = new FakeScheduler();
  const pages: Page[] = [];
  const page = (name: string): Page => {
    const channel = bus.endpoint();
    const onConflict = jest.fn();
    const onError = jest.fn();
    const live = createLiveFiles({
      libraryId: LIB, fs: disk.view(name), channel, lock, heldLocks: async () => lock.names(), visibility: alwaysVisible, textMerge,
      onConflict, onError, scheduler, peerWaitMs: 100, pollMs: 2000, persistDelayMs: 300,
    });
    const created = { live, channel, onConflict, onError };
    pages.push(created);
    return created;
  };
  return { disk, lock, scheduler, page, pages };
}

/** Opens a path in the first page to hold it: the replica reads the disk after the peer wait. */
async function openFirst(env: ReturnType<typeof world>, page: Page, path = PATH) {
  const file = page.live.open(path);
  await env.scheduler.advance(100);
  expect(await file.replica.ready).toBe("disk");
  await settle();
  return file;
}

/** Opens a path another page already holds: a peer answers, no wait is needed. */
async function openSecond(page: Page, path = PATH) {
  const file = page.live.open(path);
  await settle();
  expect(await file.replica.ready).toBe("peer");
  return file;
}

describe("createLiveFiles", () => {
  let env: ReturnType<typeof world>;
  afterEach(async () => {
    for (const { live } of env.pages) { await live.close().catch(() => undefined); }
  });

  describe("two pages over one file", () => {
    it("3.2b a file opened in page A starts from the disk text and is writable by the lock holder only after the persist delay", async () => {
      env = world();
      const a = env.page("A");
      const file = await openFirst(env, a);
      expect(file.replica.text()).toBe("hello");
      expect(env.lock.requests).toContain(writerLockName(LIB, PATH));
      file.replica.replace("hello world");
      await env.scheduler.advance(299);
      expect(env.disk.writes).toEqual([]);
      await env.scheduler.advance(1);
      expect(env.disk.text(PATH)).toBe("hello world");
      expect(env.disk.writes.map((w) => w.page)).toEqual(["A"]);
      expect(a.onError).not.toHaveBeenCalled();
    });

    it("3.2b page B opening the same path gets A's unsaved text with ready 'peer'", async () => {
      env = world();
      const fileA = await openFirst(env, env.page("A"));
      fileA.replica.replace("hello from A");
      await settle();
      const fileB = await openSecond(env.page("B"));
      expect(fileB.replica.text()).toBe("hello from A");
      expect(env.disk.text(PATH)).toBe("hello");
    });

    it("3.2b edits made in page B show in A's replica and only A writes the disk", async () => {
      env = world();
      const fileA = await openFirst(env, env.page("A"));
      const fileB = await openSecond(env.page("B"));
      fileB.replica.replace("hello from B");
      await settle();
      expect(fileA.replica.text()).toBe("hello from B");
      await env.scheduler.advance(300);
      expect(env.disk.text(PATH)).toBe("hello from B");
      expect(env.disk.writes.length).toBeGreaterThan(0);
      expect(env.disk.writes.every((w) => w.page === "A")).toBe(true);
    });

    it("3.2b edits made in page A show in B's replica", async () => {
      env = world();
      const fileA = await openFirst(env, env.page("A"));
      const fileB = await openSecond(env.page("B"));
      fileA.replica.replace("typed in A");
      await settle();
      expect(fileB.replica.text()).toBe("typed in A");
    });

    it("3.2b flush on the holder writes the pending text before the persist delay", async () => {
      env = world();
      const fileA = await openFirst(env, env.page("A"));
      fileA.replica.replace("flushed text");
      await fileA.flush();
      expect(env.disk.text(PATH)).toBe("flushed text");
      expect(env.disk.writes.map((w) => w.page)).toEqual(["A"]);
    });

    it("3.2b releasing the holder's file hands the writing to the waiting page", async () => {
      env = world();
      const fileA = await openFirst(env, env.page("A"));
      const fileB = await openSecond(env.page("B"));
      fileA.replica.replace("from A");
      await fileA.release();
      await settle();
      expect(env.disk.text(PATH)).toBe("from A");
      fileB.replica.replace("from A and B");
      await env.scheduler.advance(300);
      expect(env.disk.text(PATH)).toBe("from A and B");
      expect(env.disk.writes[env.disk.writes.length - 1]!.page).toBe("B");
    });

    it("3.2b close flushes the pending text and closes the channel", async () => {
      env = world();
      const a = env.page("A");
      const fileA = await openFirst(env, a);
      fileA.replica.replace("closing text");
      await a.live.close();
      expect(env.disk.text(PATH)).toBe("closing text");
      expect(a.channel.closed).toBe(true);
    });
  });

  describe("programmatic read and write", () => {
    it("3.2c page B write on a path page A has open resolves true and A's replica takes the text", async () => {
      env = world();
      const a = env.page("A");
      const b = env.page("B");
      const fileA = await openFirst(env, a);
      expect(await b.live.write(PATH, "written by B")).toBe(true);
      await settle();
      expect(fileA.replica.text()).toBe("written by B");
    });

    it("3.2c the disk is written by A after the persist delay and never directly by B", async () => {
      env = world();
      const a = env.page("A");
      const b = env.page("B");
      await openFirst(env, a);
      expect(await b.live.write(PATH, "written by B")).toBe(true);
      await settle();
      expect(env.disk.text(PATH)).toBe("hello");
      expect(env.disk.writes).toEqual([]);
      await env.scheduler.advance(300);
      expect(env.disk.text(PATH)).toBe("written by B");
      expect(env.disk.writes.length).toBeGreaterThan(0);
      expect(env.disk.writes.every((w) => w.page === "A")).toBe(true);
      await env.scheduler.advance(3000);
      expect(env.disk.writes.every((w) => w.page === "A")).toBe(true);
    });

    it("3.2c write on a path the page itself has open goes into its replica", async () => {
      env = world();
      const a = env.page("A");
      const fileA = await openFirst(env, a);
      expect(await a.live.write(PATH, "written by A")).toBe(true);
      expect(fileA.replica.text()).toBe("written by A");
      await env.scheduler.advance(300);
      expect(env.disk.text(PATH)).toBe("written by A");
    });

    it("3.2c write on a path no page has open resolves false and leaves the disk alone", async () => {
      env = world();
      const a = env.page("A");
      const b = env.page("B");
      await openFirst(env, a);
      expect(await b.live.write(OTHER, "ignored")).toBe(false);
      await env.scheduler.advance(5000);
      expect(env.disk.text(OTHER)).toBe("other");
      expect(env.disk.writes).toEqual([]);
      expect(env.lock.requests).not.toContain(writerLockName(LIB, OTHER));
    });

    it("3.2c write with no page holding anything resolves false", async () => {
      env = world();
      const b = env.page("B");
      expect(await b.live.write(PATH, "ignored")).toBe(false);
      await env.scheduler.advance(5000);
      expect(env.disk.text(PATH)).toBe("hello");
      expect(env.disk.writes).toEqual([]);
    });

    it("3.2c read returns the replica text of a live path, unsaved edits included", async () => {
      env = world();
      const a = env.page("A");
      const b = env.page("B");
      const fileA = await openFirst(env, a);
      fileA.replica.replace("unsaved edit");
      await settle();
      expect(await b.live.read(PATH)).toBe("unsaved edit");
      expect(await a.live.read(PATH)).toBe("unsaved edit");
      expect(env.disk.text(PATH)).toBe("hello");
    });

    it("3.2c read of a path that is not live resolves undefined", async () => {
      env = world();
      const a = env.page("A");
      const b = env.page("B");
      await openFirst(env, a);
      expect(await b.live.read(OTHER)).toBeUndefined();
    });

    it("3.2c isLive is true for a path the page holds or another page holds the writer lock of, false otherwise", async () => {
      env = world();
      const a = env.page("A");
      const b = env.page("B");
      expect(await a.live.isLive(PATH)).toBe(false);
      const fileA = await openFirst(env, a);
      expect(await a.live.isLive(PATH)).toBe(true);
      expect(await b.live.isLive(PATH)).toBe(true);
      expect(await b.live.isLive(OTHER)).toBe(false);
      await fileA.release();
      await settle();
      expect(await b.live.isLive(PATH)).toBe(false);
    });
  });

  describe("outside changes", () => {
    const BASE = "line one\nline two\nline three\n";

    it("3.2e a conflicting outside change writes a .labshelf-conflict copy and calls onConflict with its path", async () => {
      env = world({ [PATH]: BASE });
      const a = env.page("A");
      const file = await openFirst(env, a);
      file.replica.replace("line one\nLOCAL line\nline three\n");
      env.disk.external(PATH, "line one\nOUTSIDE line\nline three\n");
      await env.scheduler.advance(2000);
      expect(a.onConflict).toHaveBeenCalledTimes(1);
      const [path, copyPath] = a.onConflict.mock.calls[0] as [string, string];
      expect(path).toBe(PATH);
      expect(copyPath).toMatch(new RegExp(`^${PATH.replace(/\./g, "\\.")}\\.labshelf-conflict-`));
      expect(env.disk.text(copyPath)).toBe("line one\nOUTSIDE line\nline three\n");
      expect(env.disk.paths().filter((p) => p.includes(".labshelf-conflict-"))).toEqual([copyPath]);
      expect(file.replica.text()).toBe("line one\nLOCAL line\nline three\n");
      expect(a.onError).not.toHaveBeenCalled();
    });

    it("3.2e a non-overlapping outside change merges into the replica without a conflict copy", async () => {
      const text = "one\ntwo\nthree\nfour\nfive\n";
      env = world({ [PATH]: text });
      const a = env.page("A");
      const file = await openFirst(env, a);
      file.replica.replace("ONE\ntwo\nthree\nfour\nfive\n");
      env.disk.external(PATH, "one\ntwo\nthree\nfour\nFIVE\n");
      await env.scheduler.advance(2000);
      expect(file.replica.text()).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
      expect(a.onConflict).not.toHaveBeenCalled();
      expect(env.disk.paths().filter((p) => p.includes(".labshelf-conflict-"))).toEqual([]);
    });

    it("3.2e changed() hints make the holder take in an outside change at once", async () => {
      env = world({ [PATH]: "before" });
      const a = env.page("A");
      const file = await openFirst(env, a);
      env.disk.external(PATH, "after!");
      a.live.changed([PATH]);
      await settle();
      expect(file.replica.text()).toBe("after!");
    });

    it("3.2e a changed() hint for a path the page does not hold does nothing", async () => {
      env = world();
      const a = env.page("A");
      await openFirst(env, a);
      a.live.changed([OTHER, "projects/p/unknown.tex"]);
      await settle();
      expect(a.onError).not.toHaveBeenCalled();
      expect(env.disk.writes).toEqual([]);
    });
  });
});
