// Pins createFileWriter writing: the debounced write of the doc, the merge with an outside change and the conflict copy.
import { PATH, COPY_PATH, MARKERS, setup, LINES } from "./fileWriterHarness.js";

describe("createFileWriter: write", () => {
  it("2.1a exposes the path it writes", () => {
    expect(setup().writer.path).toBe(PATH);
  });

  it("2.1a writes the doc text once, 300 ms after the last of several quick changes and not before", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    replica.replace("first\n");
    await scheduler.advance(200);
    replica.replace("second\n");
    await scheduler.advance(200);
    replica.replace("third\n");
    await scheduler.advance(299);
    expect(files.writes).toEqual([]);
    expect(files.text(PATH)).toBe("base\n");
    await scheduler.advance(1);
    expect(files.writes).toEqual([{ path: PATH, text: "third\n" }]);
    await scheduler.advance(2000);
    expect(files.count("write")).toBe(1);
  });

  it("2.1a honours persistDelayMs", async () => {
    const { files, scheduler, replica, writer } = setup({ persistDelayMs: 50 });
    await writer.start();
    replica.replace("quick\n");
    await scheduler.advance(49);
    expect(files.writes).toEqual([]);
    await scheduler.advance(1);
    expect(files.writes).toEqual([{ path: PATH, text: "quick\n" }]);
  });

  it("2.1a persists a change whatever its origin is, as long as it is not disk", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    replica.replace("from another page\n", "peer");
    await scheduler.advance(300);
    expect(files.writes).toEqual([{ path: PATH, text: "from another page\n" }]);
  });

  it("2.1a writes nothing when the doc text came back to what the disk holds", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    replica.replace("changed\n");
    replica.replace("base\n");
    await scheduler.advance(300);
    expect(files.writes).toEqual([]);
    expect(files.text(PATH)).toBe("base\n");
  });

  it("2.1a keeps the base after a write, so the next change writes again without a merge", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    replica.replace("one\n");
    await scheduler.advance(300);
    replica.replace("two\n");
    await scheduler.advance(300);
    expect(files.writes.map((write) => write.text)).toEqual(["one\n", "two\n"]);
  });

  it("2.1b writes the merged text when the disk changed another line since base, and the doc takes it in too", async () => {
    const { files, scheduler, replica, writer, origins, conflicts } = setup({ disk: LINES });
    await writer.start();
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 disk\n");
    replica.replace("L1 doc\nl2\nl3\nl4\nl5\n");
    await scheduler.advance(300);
    const merged = "L1 doc\nl2\nl3\nl4\nl5 disk\n";
    expect(files.text(PATH)).toBe(merged);
    expect(replica.text()).toBe(merged);
    expect(files.count("write")).toBe(1);
    expect(conflicts).toEqual([]);
    expect(origins.filter((origin) => origin === "disk")).toHaveLength(1);
    expect(origins[origins.length - 1]).toBe("disk");
  });

  it("2.1b does not persist the merge result a second time", async () => {
    const { files, scheduler, replica, writer } = setup({ disk: LINES });
    await writer.start();
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 disk\n");
    replica.replace("L1 doc\nl2\nl3\nl4\nl5\n");
    await scheduler.advance(300);
    files.clearLog();
    await scheduler.advance(5000);
    expect(files.log).toEqual([]);
  });

  it("2.1b updates with origin disk never arm the persist timer", async () => {
    const { files, scheduler, replica, writer } = setup();
    await writer.start();
    files.clearLog();
    replica.replace("applied from disk\n", "disk");
    await scheduler.advance(5000);
    expect(files.log).toEqual([]);
  });

  it("2.1b takes the disk text into the doc when the doc had no own edits and the disk changed", async () => {
    const { files, scheduler, replica, writer } = setup({ disk: LINES });
    await writer.start();
    files.external(PATH, "l1\nl2\nl3\nl4\nl5 disk\n");
    await writer.sync();
    expect(replica.text()).toBe("l1\nl2\nl3\nl4\nl5 disk\n");
    expect(files.count("write")).toBe(0);
    await scheduler.advance(1000);
    expect(files.count("write")).toBe(0);
  });

  it("2.1c keeps the doc's side in the file, writes the disk side to the conflict copy and calls onConflict with both paths", async () => {
    const { files, scheduler, replica, writer, conflicts } = setup({ disk: "one\ntwo\nthree\n" });
    await writer.start();
    files.external(PATH, "one\nTWO disk\nthree\n");
    replica.replace("one\nTWO doc\nthree\n");
    await scheduler.advance(300);
    expect(files.text(PATH)).toBe("one\nTWO doc\nthree\n");
    expect(files.text(COPY_PATH)).toBe("one\nTWO disk\nthree\n");
    expect(conflicts).toEqual([[PATH, COPY_PATH]]);
    expect(replica.text()).toBe("one\nTWO doc\nthree\n");
  });

  it("2.1c writes no conflict markers to the file, the copy or the doc", async () => {
    const { files, scheduler, replica, writer } = setup({ disk: "one\ntwo\nthree\n" });
    await writer.start();
    files.external(PATH, "one\nTWO disk\nthree\n");
    replica.replace("one\nTWO doc\nthree\n");
    await scheduler.advance(300);
    for (const text of [files.text(PATH), files.text(COPY_PATH), replica.text()]) { expect(text).not.toMatch(MARKERS); }
  });

  it("2.1c reports the conflict once and does not rewrite the file on later persists of unchanged text", async () => {
    const { files, scheduler, replica, writer, conflicts } = setup({ disk: "one\ntwo\nthree\n" });
    await writer.start();
    files.external(PATH, "one\nTWO disk\nthree\n");
    replica.replace("one\nTWO doc\nthree\n");
    await scheduler.advance(300);
    files.clearLog();
    await scheduler.advance(5000);
    await writer.sync();
    expect(conflicts).toHaveLength(1);
    expect(files.count("write")).toBe(0);
  });

  it("2.1c generates the conflict copy path from the copyId when one is given", async () => {
    const { files, scheduler, replica, writer } = setup({ disk: "one\ntwo\nthree\n" });
    await writer.start();
    files.external(PATH, "one\nTWO disk\nthree\n");
    replica.replace("one\nTWO doc\nthree\n");
    await scheduler.advance(300);
    expect([...files.entries.keys()].sort()).toEqual([PATH, COPY_PATH].sort());
  });
});
