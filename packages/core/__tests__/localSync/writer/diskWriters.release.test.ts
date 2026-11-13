// Pins createDiskWriters bridge changed hints, release counting and close.
import { lockName, makePage, makeReplica, newWorld, settle } from "./diskWritersHarness.js";

describe("createDiskWriters: release", () => {
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
