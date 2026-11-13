// Pins followLiveNotes: it holds the notes.qmd replica of the live files and reports bursts of changes.
import { createReplicaHub, type Replica, type ReplicaChannel } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("idb", () => ({ openDB: async () => require("../../support/fakeIdb").fakeDb }));
jest.mock("../../../src/storage/libraryFileSystem", () => ({ createLibraryFileSystem: () => { throw new Error("the real library file system is not available in this test"); } }));

import { followLiveNotes, type LiveFiles } from "../../../src/localSync/liveFiles";
import { FakeScheduler, LIB, NOTES, settle } from "./liveNotesFixtures";

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
