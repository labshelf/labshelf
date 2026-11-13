// Pins createFileWriter checking and syncing: the stat-gated check, start, the serialized queue, stop and error reporting.
import { PATH, settle, setup, LINES } from "./fileWriterHarness.js";

describe("createFileWriter: sync", () => {
  it("2.1d check() with an unchanged stat reads nothing and changes nothing", async () => {
    const { files, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    await writer.check();
    expect(files.count("read")).toBe(0);
    expect(files.count("write")).toBe(0);
    expect(replica.text()).toBe("base\n");
  });

  it("2.1d check() with a changed stat merges the disk text into the doc and writes nothing when the doc had no own edits", async () => {
    const { files, replica, writer, origins } = setup({ disk: LINES });
    await writer.start();
    files.clearLog();
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 disk\n");
    await writer.check();
    expect(replica.text()).toBe("l1\nl2\nl3\nl4\nl5 disk\n");
    expect(files.count("write")).toBe(0);
    expect(origins[origins.length - 1]).toBe("disk");
  });

  it("2.1d check() merges the disk text with the doc's own unsaved edits and writes the merged text", async () => {
    const { files, replica, writer } = setup({ disk: LINES });
    await writer.start();
    replica.replace("L1 doc\nl2\nl3\nl4\nl5\n");
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 disk\n");
    await writer.check();
    expect(files.text(PATH)).toBe("L1 doc\nl2\nl3\nl4\nl5 disk\n");
    expect(replica.text()).toBe("L1 doc\nl2\nl3\nl4\nl5 disk\n");
  });

  it("2.1d check() runs a sync when only the size changed", async () => {
    const { files, replica, writer } = setup({ disk: LINES });
    await writer.start();
    const mtime = files.entries.get(PATH)!.mtime;
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 longer\n", mtime);
    await writer.check();
    expect(replica.text()).toBe("l1\nl2\nl3\nl4\nl5 longer\n");
  });

  it("2.1d check() runs a sync when only the modification time changed", async () => {
    const { files, replica, writer } = setup({ disk: LINES });
    await writer.start();
    const mtime = files.entries.get(PATH)!.mtime;
    files.external(PATH, "L1\nl2\nl3\nl4\nl5\n", mtime + 7);
    await writer.check();
    expect(replica.text()).toBe("L1\nl2\nl3\nl4\nl5\n");
  });

  it("2.1d check() does not read after the writer's own write", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    replica.replace("mine\n");
    await scheduler.advance(300);
    files.clearLog();
    await writer.check();
    expect(files.count("read")).toBe(0);
  });

  it("2.1d check() reads once after a touch that changed no text, then not again", async () => {
    const { files, replica, writer } = setup();
    await writer.start();
    files.touch(PATH);
    files.clearLog();
    await writer.check();
    expect(files.count("read")).toBe(1);
    expect(files.count("write")).toBe(0);
    expect(replica.text()).toBe("base\n");
    files.clearLog();
    await writer.check();
    expect(files.count("read")).toBe(0);
  });

  it("2.1d sync() reads the disk even when the stat is unchanged", async () => {
    const { files, replica, writer } = setup({ disk: LINES });
    await writer.start();
    files.clearLog();
    const stat = files.entries.get(PATH)!;
    files.external(PATH, "l1\nl2\nl3\nl4\nL5\n", stat.mtime);
    await writer.sync();
    expect(files.count("read")).toBe(1);
    expect(replica.text()).toBe("l1\nl2\nl3\nl4\nL5\n");
  });

  it("2.1e start() on a doc whose text differs from the disk writes the doc's text at once", async () => {
    const { files, replica, writer } = setup({ disk: "on disk\n", doc: "unsaved edits\n" });
    await writer.start();
    expect(files.writes).toEqual([{ path: PATH, text: "unsaved edits\n" }]);
    expect(replica.text()).toBe("unsaved edits\n");
  });

  it("2.1e start() needs no timer to write the differing doc", async () => {
    const { files, scheduler, writer } = setup({ disk: "on disk\n", doc: "unsaved edits\n" });
    await writer.start();
    expect(files.count("write")).toBe(1);
    await scheduler.advance(5000);
    expect(files.count("write")).toBe(1);
  });

  it("2.1e start() on a doc equal to the disk writes nothing", async () => {
    const { files, scheduler, writer } = setup({ disk: "same\n", doc: "same\n" });
    await writer.start();
    await scheduler.advance(5000);
    expect(files.count("write")).toBe(0);
    expect(files.text(PATH)).toBe("same\n");
  });

  it("2.1e start() reads the disk and stats the file", async () => {
    const { files, writer } = setup({ disk: "same\n", doc: "same\n" });
    await writer.start();
    expect(files.count("read")).toBeGreaterThanOrEqual(1);
    expect(files.count("stat")).toBeGreaterThanOrEqual(1);
  });

  it("2.1e start() then check() with nothing changed reads nothing", async () => {
    const { files, writer } = setup({ disk: "same\n", doc: "unsaved\n" });
    await writer.start();
    files.clearLog();
    await writer.check();
    expect(files.count("read")).toBe(0);
  });

  it("2.1f a persist timer firing during a slow write never overlaps it and the later text is written after it", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    const release = files.hold("write");
    replica.replace("one\n");
    await scheduler.advance(300);
    replica.replace("two\n");
    await scheduler.advance(300);
    expect(files.count("write")).toBe(1);
    release();
    await settle();
    expect(files.writes.map((write) => write.text)).toEqual(["one\n", "two\n"]);
    expect(files.text(PATH)).toBe("two\n");
    expect(files.maxInFlight).toBe(1);
  });

  it("2.1f a check during a sync waits for it and never runs two file calls at once", async () => {
    const { files, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    files.external(PATH, "changed outside\n");
    const release = files.hold("read");
    const syncing = writer.sync();
    const checking = writer.check();
    await settle();
    expect(files.log.filter((line) => line.startsWith("stat "))).toEqual([]);
    release();
    await Promise.all([syncing, checking]);
    expect(files.maxInFlight).toBe(1);
    expect(replica.text()).toBe("changed outside\n");
  });

  it("2.1f calls made together run in call order", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    replica.replace("pending\n");
    const release = files.hold("read");
    const syncing = writer.sync();
    const flushing = writer.flush();
    const checking = writer.check();
    await settle();
    release();
    await Promise.all([syncing, flushing, checking]);
    expect(files.maxInFlight).toBe(1);
    expect(files.text(PATH)).toBe("pending\n");
    await scheduler.advance(1000);
    expect(files.count("write")).toBe(1);
  });

  it("2.1f sync() takes the doc text after the disk read resolves", async () => {
    const { files, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    const release = files.hold("read");
    const syncing = writer.sync();
    await settle();
    replica.replace("typed during the read\n");
    release();
    await syncing;
    expect(files.text(PATH)).toBe("typed during the read\n");
  });

  it("2.1f a persist timer firing during a slow read queues one more sync", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    const release = files.hold("read");
    const syncing = writer.sync();
    await settle();
    replica.replace("during\n");
    await scheduler.advance(300);
    release();
    await syncing;
    await settle();
    expect(files.text(PATH)).toBe("during\n");
    expect(files.maxInFlight).toBe(1);
  });

  it("2.1g stop() flushes a pending change", async () => {
    const { files, replica, writer } = setup();
    await writer.start();
    replica.replace("pending\n");
    await writer.stop();
    expect(files.text(PATH)).toBe("pending\n");
  });

  it("2.1g after stop() no read, stat or write is made", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    replica.replace("pending\n");
    await writer.stop();
    files.clearLog();
    replica.replace("later\n");
    await scheduler.advance(5000);
    await writer.check();
    await writer.sync();
    await writer.flush();
    await writer.stop();
    expect(files.log).toEqual([]);
    expect(files.text(PATH)).toBe("pending\n");
  });

  it("2.1g stop() with nothing pending writes nothing", async () => {
    const { files, writer } = setup();
    await writer.start();
    files.clearLog();
    await writer.stop();
    expect(files.count("write")).toBe(0);
  });

  it("2.1g stop() waits for a write in flight", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    const release = files.hold("write");
    replica.replace("slow\n");
    await scheduler.advance(300);
    let stopped = false;
    const stopping = writer.stop().then(() => { stopped = true; });
    await settle();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(files.text(PATH)).toBe("slow\n");
    files.clearLog();
    await scheduler.advance(5000);
    await writer.check();
    expect(files.log).toEqual([]);
  });

  it("2.1h a failing read is passed to onError, writes nothing, and the next change still persists", async () => {
    const { files, scheduler, replica, writer, errors } = setup();
    await writer.start();
    files.clearLog();
    const error = files.failNext("read");
    replica.replace("lost\n");
    await scheduler.advance(300);
    expect(errors).toEqual([error]);
    expect(errors[0]).toBe(error);
    expect(files.writes).toEqual([]);
    replica.replace("kept\n");
    await scheduler.advance(300);
    expect(files.text(PATH)).toBe("kept\n");
    expect(errors).toHaveLength(1);
  });

  it("2.1h a failing write is passed to onError and the next change persists against the unchanged base", async () => {
    const { files, scheduler, replica, writer, errors } = setup();
    await writer.start();
    const error = files.failNext("write");
    replica.replace("not saved\n");
    await scheduler.advance(300);
    expect(errors).toEqual([error]);
    expect(files.text(PATH)).toBe("base\n");
    replica.replace("saved\n");
    await scheduler.advance(300);
    expect(files.text(PATH)).toBe("saved\n");
    expect(files.count("write")).toBe(2);
    expect(files.entries.size).toBe(1);
  });

  it("2.1h a failing write is retried by a later sync() without a change", async () => {
    const { files, replica, writer, errors } = setup();
    await writer.start();
    files.failNext("write");
    replica.replace("retry me\n");
    await writer.flush();
    expect(errors).toHaveLength(1);
    await writer.sync();
    expect(files.text(PATH)).toBe("retry me\n");
  });

  it("2.1h a failing stat in check() is passed to onError and the next check() still takes the change in", async () => {
    const { files, replica, writer, errors } = setup({ disk: LINES });
    await writer.start();
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 disk\n");
    const error = files.failNext("stat");
    await writer.check();
    expect(errors).toEqual([error]);
    expect(replica.text()).toBe(LINES);
    await writer.check();
    expect(replica.text()).toBe("l1\nl2\nl3\nl4\nl5 disk\n");
  });

  it("2.1h a failing read leaves the queue going for calls made behind it", async () => {
    const { files, replica, writer, errors } = setup();
    await writer.start();
    files.failNext("read");
    const failing = writer.sync();
    replica.replace("after\n");
    const next = writer.sync();
    await Promise.all([failing, next]);
    expect(errors).toHaveLength(1);
    expect(files.text(PATH)).toBe("after\n");
  });

  it("2.1h without an onError the failure is ignored and the call resolves", async () => {
    const { files, scheduler, replica, writer } = setup({ reportErrors: false });
    await writer.start();
    files.failNext("read");
    await expect(writer.sync()).resolves.toBeUndefined();
    files.failNext("write");
    replica.replace("x\n");
    await scheduler.advance(300);
    replica.replace("y\n");
    await scheduler.advance(300);
    expect(files.text(PATH)).toBe("y\n");
  });
});
