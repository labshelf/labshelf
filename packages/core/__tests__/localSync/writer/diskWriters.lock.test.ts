// Pins createDiskWriters locking: one writer per file per page through a shared lock, and a queued page taking over when the holder releases.
import { POLL_MS, writerLockName } from "../../../src/localSync/writer/diskWriters.js";
import { lockName, makePage, makeReplica, newWorld, settle } from "./diskWritersHarness.js";

describe("createDiskWriters: lock", () => {
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
});
