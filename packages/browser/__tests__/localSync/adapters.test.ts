// Pins the browser port adapters of local sync: the BroadcastChannel replica channel, the Web Lock writer lock, the held-lock query, document visibility and the LibraryFileSystem writer files.
import type { LibraryFileSystem, LocalStat, ReplicaMessage } from "@labshelf/core";
import {
  createBroadcastReplicaChannel, createDocumentVisibility, createLibraryWriterFiles, createWebLockWriterLock, readHeldLockNames,
} from "../../src/localSync/adapters";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); }
};

// ---- Fake BroadcastChannel: structured-clone-like delivery to the other channels of one name, in this realm.

function clone(value: unknown): unknown {
  if (value instanceof Uint8Array) { return new Uint8Array(value); }
  if (Array.isArray(value)) { return value.map(clone); }
  if (value !== null && typeof value === "object") { return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])); }
  return value;
}

type MessageListener = (event: { data: unknown }) => void;

class FakeBroadcast {
  static created: FakeBroadcast[] = [];
  closed = false;
  onmessage: MessageListener | null = null;
  private readonly listeners = new Set<MessageListener>();

  constructor(readonly name: string) { FakeBroadcast.created.push(this); }

  postMessage(data: unknown): void {
    if (this.closed) { throw new Error("InvalidStateError"); }
    for (const other of FakeBroadcast.created) {
      if (other !== this && other.name === this.name) {
        const copy = clone(data);
        queueMicrotask(() => { other.dispatch(copy); });
      }
    }
  }

  addEventListener(type: string, listener: MessageListener): void { if (type === "message") { this.listeners.add(listener); } }

  removeEventListener(type: string, listener: MessageListener): void { if (type === "message") { this.listeners.delete(listener); } }

  close(): void { this.closed = true; }

  /** Delivers raw data as the browser would, to let a test send malformed messages. */
  dispatch(data: unknown): void {
    if (this.closed) { return; }
    this.onmessage?.({ data });
    for (const listener of [...this.listeners]) { listener({ data }); }
  }
}

const factory = (name: string): BroadcastChannel => new FakeBroadcast(name) as unknown as BroadcastChannel;

describe("createBroadcastReplicaChannel", () => {
  beforeEach(() => { FakeBroadcast.created = []; });

  it("3.2a opens one long-lived channel under the given name", () => {
    const channel = createBroadcastReplicaChannel("labshelf:files:lib1", factory);
    expect(FakeBroadcast.created.map((c) => c.name)).toEqual(["labshelf:files:lib1"]);
    channel.post({ key: "a", from: "p", bytes: new Uint8Array([1]) });
    channel.post({ key: "b", from: "p", bytes: new Uint8Array([2]) });
    expect(FakeBroadcast.created).toHaveLength(1);
    channel.close();
  });

  it("3.2a delivers a ReplicaMessage with Uint8Array bytes to another adapter on the same name", async () => {
    const a = createBroadcastReplicaChannel("n", factory);
    const b = createBroadcastReplicaChannel("n", factory);
    const received: ReplicaMessage[] = [];
    b.onMessage((message) => { received.push(message); });
    a.post({ key: "projects/p/main.tex", from: "page-a", bytes: new Uint8Array([1, 2, 3]) });
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]!.key).toBe("projects/p/main.tex");
    expect(received[0]!.from).toBe("page-a");
    expect(received[0]!.bytes).toBeInstanceOf(Uint8Array);
    expect([...received[0]!.bytes]).toEqual([1, 2, 3]);
    a.close();
    b.close();
  });

  it("3.2a keeps the addressee of a message", async () => {
    const a = createBroadcastReplicaChannel("n", factory);
    const b = createBroadcastReplicaChannel("n", factory);
    const received: ReplicaMessage[] = [];
    b.onMessage((message) => { received.push(message); });
    a.post({ key: "k", from: "page-a", to: "page-b", bytes: new Uint8Array([9]) });
    await flush();
    expect(received.map((m) => m.to)).toEqual(["page-b"]);
    a.close();
    b.close();
  });

  it("3.2a does not deliver across names or to the sending adapter", async () => {
    const a = createBroadcastReplicaChannel("n", factory);
    const other = createBroadcastReplicaChannel("m", factory);
    const onA = jest.fn();
    const onOther = jest.fn();
    a.onMessage(onA);
    other.onMessage(onOther);
    a.post({ key: "k", from: "p", bytes: new Uint8Array([1]) });
    await flush();
    expect(onA).not.toHaveBeenCalled();
    expect(onOther).not.toHaveBeenCalled();
    a.close();
    other.close();
  });

  it("3.2a drops malformed messages and still delivers the next valid one", async () => {
    const a = createBroadcastReplicaChannel("n", factory);
    const b = createBroadcastReplicaChannel("n", factory);
    const received: ReplicaMessage[] = [];
    b.onMessage((message) => { received.push(message); });
    const raw = FakeBroadcast.created[1]!;
    raw.dispatch(null);
    raw.dispatch("text");
    raw.dispatch(42);
    raw.dispatch({ key: 1, from: "p", bytes: new Uint8Array([1]) });
    raw.dispatch({ key: "k", from: 7, bytes: new Uint8Array([1]) });
    raw.dispatch({ key: "k", from: "p" });
    raw.dispatch({ key: "k", from: "p", bytes: "abc" });
    raw.dispatch({ key: "k", from: "p", bytes: [1, 2, 3] });
    raw.dispatch({ key: "k", from: "p", to: 5, bytes: new Uint8Array([1]) });
    expect(received).toEqual([]);
    a.post({ key: "ok", from: "p", bytes: new Uint8Array([4]) });
    await flush();
    expect(received.map((m) => m.key)).toEqual(["ok"]);
    a.close();
    b.close();
  });

  it("3.2a stops calling a listener once it unsubscribed", async () => {
    const a = createBroadcastReplicaChannel("n", factory);
    const b = createBroadcastReplicaChannel("n", factory);
    const listener = jest.fn();
    const stop = b.onMessage(listener);
    a.post({ key: "k", from: "p", bytes: new Uint8Array([1]) });
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    a.post({ key: "k", from: "p", bytes: new Uint8Array([2]) });
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    a.close();
    b.close();
  });

  it("3.2a close closes the underlying channel and silences listeners", async () => {
    const a = createBroadcastReplicaChannel("n", factory);
    const b = createBroadcastReplicaChannel("n", factory);
    const listener = jest.fn();
    b.onMessage(listener);
    b.close();
    expect(FakeBroadcast.created[1]!.closed).toBe(true);
    expect(FakeBroadcast.created[0]!.closed).toBe(false);
    FakeBroadcast.created[1]!.closed = false;
    FakeBroadcast.created[1]!.dispatch({ key: "k", from: "p", bytes: new Uint8Array([1]) });
    expect(listener).not.toHaveBeenCalled();
    a.close();
  });
});

// ---- Fake Web Locks: exclusive, FIFO per name, abortable while pending, with query().

class FakeLockManager {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Array<{ run(): void }>>();

  request(name: string, a: unknown, b?: unknown): Promise<unknown> {
    const options = (typeof a === "function" ? {} : a) as { signal?: AbortSignal };
    const callback = (typeof a === "function" ? a : b) as (lock: { name: string }) => unknown;
    const abortError = (): Error => Object.assign(new Error("The request was aborted"), { name: "AbortError" });
    return new Promise((resolve, reject) => {
      const grant = (): void => {
        this.held.add(name);
        const release = (): void => { this.held.delete(name); this.queues.get(name)?.shift()?.run(); };
        void Promise.resolve().then(() => callback({ name })).then((value) => { release(); resolve(value); }, (error: unknown) => { release(); reject(error); });
      };
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      if (!this.held.has(name) && queue.length === 0) {
        if (options.signal?.aborted) { reject(abortError()); return; }
        grant();
        return;
      }
      if (options.signal?.aborted) { reject(abortError()); return; }
      const waiter = { run: () => { options.signal?.removeEventListener("abort", onAbort); grant(); } };
      const onAbort = (): void => { const at = queue.indexOf(waiter); if (at >= 0) { queue.splice(at, 1); } reject(abortError()); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
    });
  }

  async query(): Promise<{ held: Array<{ name: string }>; pending: Array<{ name: string }> }> {
    return {
      held: [...this.held].map((name) => ({ name })),
      pending: [...this.queues].flatMap(([name, queue]) => queue.map(() => ({ name }))),
    };
  }
}

const asManager = (manager: FakeLockManager): LockManager => manager as unknown as LockManager;

describe("createWebLockWriterLock", () => {
  it("3.2a grants the lock in FIFO order, one holder at a time", async () => {
    const lock = createWebLockWriterLock(asManager(new FakeLockManager()));
    const granted: number[] = [];
    const cancel1 = lock.request("n", () => { granted.push(1); });
    const cancel2 = lock.request("n", () => { granted.push(2); });
    const cancel3 = lock.request("n", () => { granted.push(3); });
    await flush();
    expect(granted).toEqual([1]);
    cancel1();
    await flush();
    expect(granted).toEqual([1, 2]);
    cancel2();
    await flush();
    expect(granted).toEqual([1, 2, 3]);
    cancel3();
  });

  it("3.2a grants different names independently", async () => {
    const lock = createWebLockWriterLock(asManager(new FakeLockManager()));
    const granted: string[] = [];
    lock.request("a", () => { granted.push("a"); });
    lock.request("b", () => { granted.push("b"); });
    await flush();
    expect(granted.sort()).toEqual(["a", "b"]);
  });

  it("3.2a cancel before the grant never calls onGranted", async () => {
    const lock = createWebLockWriterLock(asManager(new FakeLockManager()));
    const granted: number[] = [];
    const cancel1 = lock.request("n", () => { granted.push(1); });
    const cancel2 = lock.request("n", () => { granted.push(2); });
    lock.request("n", () => { granted.push(3); });
    await flush();
    cancel2();
    await flush();
    cancel1();
    await flush();
    expect(granted).toEqual([1, 3]);
  });

  it("3.2a swallows the abort of a request cancelled before the grant", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const lock = createWebLockWriterLock(asManager(new FakeLockManager()));
      const cancel1 = lock.request("n", () => undefined);
      const cancel2 = lock.request("n", () => undefined);
      await flush();
      cancel2();
      await flush();
      cancel1();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("3.2a cancel after the grant hands the lock to the next waiter", async () => {
    const manager = new FakeLockManager();
    const lock = createWebLockWriterLock(asManager(manager));
    const granted: number[] = [];
    const cancel1 = lock.request("n", () => { granted.push(1); });
    lock.request("n", () => { granted.push(2); });
    await flush();
    expect((await manager.query()).held.map((h) => h.name)).toEqual(["n"]);
    cancel1();
    await flush();
    expect(granted).toEqual([1, 2]);
  });

  it("3.2a holds the lock until cancel, and a second cancel does nothing", async () => {
    const lock = createWebLockWriterLock(asManager(new FakeLockManager()));
    const granted: number[] = [];
    const cancel1 = lock.request("n", () => { granted.push(1); });
    lock.request("n", () => { granted.push(2); });
    lock.request("n", () => { granted.push(3); });
    await flush();
    await flush();
    expect(granted).toEqual([1]);
    cancel1();
    await flush();
    expect(granted).toEqual([1, 2]);
    cancel1();
    await flush();
    expect(granted).toEqual([1, 2]);
  });
});

describe("readHeldLockNames", () => {
  it("3.2a lists the names of held and pending locks", async () => {
    const manager = new FakeLockManager();
    const lock = createWebLockWriterLock(asManager(manager));
    expect(await readHeldLockNames(asManager(manager))).toEqual([]);
    const cancelA = lock.request("a", () => undefined);
    lock.request("a", () => undefined);
    const cancelB = lock.request("b", () => undefined);
    await flush();
    const names = await readHeldLockNames(asManager(manager));
    expect(new Set(names)).toEqual(new Set(["a", "b"]));
    cancelA();
    cancelB();
    await flush();
    await flush();
    expect(new Set(await readHeldLockNames(asManager(manager)))).toEqual(new Set(["a"]));
  });
});

describe("createDocumentVisibility", () => {
  const setup = () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as string });
    const win = new EventTarget();
    const visibility = createDocumentVisibility(doc as unknown as Document, win as unknown as Window);
    return { doc, win, visibility };
  };

  it("3.2a reports document.visibilityState === 'visible'", () => {
    const { doc, visibility } = setup();
    expect(visibility.visible()).toBe(true);
    doc.visibilityState = "hidden";
    expect(visibility.visible()).toBe(false);
  });

  it("3.2a calls onVisible listeners when the page becomes visible or the window gains focus", () => {
    const { doc, win, visibility } = setup();
    const listener = jest.fn();
    visibility.onVisible(listener);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("3.2a removes both listeners when the returned function is called", () => {
    const { doc, win, visibility } = setup();
    const listener = jest.fn();
    const stop = visibility.onVisible(listener);
    stop();
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createLibraryWriterFiles", () => {
  const stat = (mtimeMs: number, size: number): LocalStat => ({ isFile: true, isDirectory: false, mtimeMs, size });

  const fakeFs = (stats: Record<string, LocalStat | undefined> = {}) => {
    const fs = {
      readText: jest.fn(async (path: string) => `text of ${path}`),
      writeText: jest.fn(async (_path: string, _text: string) => undefined),
      stat: jest.fn(async (path: string) => stats[path]),
    };
    return { fs, files: createLibraryWriterFiles(fs as unknown as LibraryFileSystem) };
  };

  it("3.2a reads and writes text through the library file system", async () => {
    const { fs, files } = fakeFs();
    expect(await files.read("projects/p/main.tex")).toBe("text of projects/p/main.tex");
    await files.write("projects/p/main.tex", "new text");
    expect(fs.readText).toHaveBeenCalledWith("projects/p/main.tex");
    expect(fs.writeText).toHaveBeenCalledWith("projects/p/main.tex", "new text");
  });

  it("3.2a maps stat to lastModified and size", async () => {
    const { files } = fakeFs({ "a.tex": stat(1234, 56) });
    const result = await files.stat("a.tex");
    expect(result.lastModified).toBe(1234);
    expect(result.size).toBe(56);
  });

  it("3.2a throws an error naming the path when stat finds no file", async () => {
    const { files } = fakeFs({});
    const attempt = Promise.resolve().then(() => files.stat("projects/p/gone.tex"));
    await expect(attempt).rejects.toBeInstanceOf(Error);
    await expect(attempt).rejects.toThrow("projects/p/gone.tex");
  });
});
