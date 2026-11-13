// Pins createDiskWriters watching: the stat poll while visible and the observer events that replace it.
import { POLL_MS } from "../../../src/localSync/writer/diskWriters.js";
import { makePage, makeReplica, newWorld, settle } from "./diskWritersHarness.js";

describe("createDiskWriters: watch", () => {
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
});
