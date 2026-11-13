// Pins createFileWriter: the checked, debounced write of one file for one replica, its merge with outside changes, the stat-gated check, and the serialized queue.
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };
import * as Y from "yjs";

import type { SessionScheduler } from "../../../src/collab/channel.js";
import { createFileWriter, type FileWriter } from "../../../src/localSync/writer/fileWriter.js";
import type { FileStat, WriterFiles, WriterReplica } from "../../../src/localSync/writer/ports.js";
import { createTextMerge } from "../../../src/writing/textMerge.js";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads (as itemFileMerge.ts does).
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;
const textMerge = createTextMerge(diff3Merge);

const PATH = "paper/main.tex";
const COPY_ID = "11111111-2222-4333-8444-555555555555";
const COPY_PATH = `${PATH}.labshelf-conflict-${COPY_ID}`;
const MARKERS = /^(<<<<<<<|=======|>>>>>>>)/m;

const settle = async (): Promise<void> => { for (let i = 0; i < 3; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); } };

/** A manual clock: timers fire only when advance() moves time past them. */
class ManualScheduler implements SessionScheduler {
  private time = 0;
  private timers: { at: number; fn: () => void }[] = [];
  now(): number { return this.time; }
  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.time + ms, fn };
    this.timers.push(timer);
    return () => { this.timers = this.timers.filter((candidate) => candidate !== timer); };
  }
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) { break; }
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = Math.max(this.time, due.at);
      due.fn();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

type Kind = "read" | "stat" | "write";

/** In-memory files that log every call, count calls in flight, and can hold or fail the next call of a kind. */
class FakeFiles implements WriterFiles {
  readonly entries = new Map<string, { text: string; mtime: number; size: number }>();
  log: string[] = [];
  writes: { path: string; text: string }[] = [];
  maxInFlight = 0;
  private inFlight = 0;
  private clock = 1000;
  private holds: Partial<Record<Kind, Promise<void>>> = {};
  private failures: Partial<Record<Kind, unknown>> = {};

  constructor(initial: Record<string, string>) {
    for (const [path, text] of Object.entries(initial)) { this.entries.set(path, { text, mtime: (this.clock += 1), size: text.length }); }
  }

  text(path: string): string | undefined { return this.entries.get(path)?.text; }
  count(kind: Kind): number { return this.log.filter((line) => line.startsWith(`${kind} `)).length; }
  clearLog(): void { this.log = []; this.writes = []; }
  /** Another app changes a file: the text changes and, unless given, the modification time moves. */
  external(path: string, text: string, mtime?: number): void { this.entries.set(path, { text, mtime: mtime ?? (this.clock += 1), size: text.length }); }
  /** Another app touches a file without changing its text. */
  touch(path: string): void { const entry = this.entries.get(path)!; entry.mtime = this.clock += 1; }
  hold(kind: Kind): () => void {
    let release!: () => void;
    this.holds[kind] = new Promise<void>((resolve) => { release = resolve; });
    return () => { delete this.holds[kind]; release(); };
  }
  failNext(kind: Kind, error: unknown = new Error(`${kind} failed`)): unknown { this.failures[kind] = error; return error; }

  private async run<T>(kind: Kind, path: string, body: () => T): Promise<T> {
    this.log.push(`${kind} ${path}`);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await (this.holds[kind] ?? Promise.resolve());
      if (kind in this.failures) { const error = this.failures[kind]; delete this.failures[kind]; throw error; }
      return body();
    } finally { this.inFlight -= 1; }
  }

  read(path: string): Promise<string> {
    return this.run("read", path, () => {
      const entry = this.entries.get(path);
      if (!entry) { throw new Error(`ENOENT ${path}`); }
      return entry.text;
    });
  }
  stat(path: string): Promise<FileStat> {
    return this.run("stat", path, () => {
      const entry = this.entries.get(path);
      if (!entry) { throw new Error(`ENOENT ${path}`); }
      return { lastModified: entry.mtime, size: entry.size };
    });
  }
  write(path: string, text: string): Promise<void> {
    return this.run("write", path, () => {
      this.writes.push({ path, text });
      this.entries.set(path, { text, mtime: (this.clock += 1), size: text.length });
    });
  }
}

/** A replica over one Y.Text; replace is a no-op when equal and otherwise one transaction with the given origin. */
function makeReplica(initial: string): WriterReplica {
  const doc = new Y.Doc();
  const ytext = doc.getText("text");
  if (initial) { ytext.insert(0, initial); }
  return {
    doc,
    text: () => ytext.toString(),
    replace: (text: string, origin?: unknown) => {
      const current = ytext.toString();
      if (current === text) { return; }
      let start = 0;
      while (start < current.length && start < text.length && current[start] === text[start]) { start += 1; }
      let end = 0;
      while (end < current.length - start && end < text.length - start && current[current.length - 1 - end] === text[text.length - 1 - end]) { end += 1; }
      doc.transact(() => {
        ytext.delete(start, current.length - start - end);
        ytext.insert(start, text.slice(start, text.length - end));
      }, origin);
    },
  };
}

interface Setup {
  files: FakeFiles;
  scheduler: ManualScheduler;
  replica: WriterReplica;
  writer: FileWriter;
  conflicts: [string, string][];
  errors: unknown[];
  origins: unknown[];
}

function setup(options: { disk?: string; doc?: string; persistDelayMs?: number; reportErrors?: boolean } = {}): Setup {
  const disk = options.disk ?? "base\n";
  const files = new FakeFiles({ [PATH]: disk });
  const scheduler = new ManualScheduler();
  const replica = makeReplica(options.doc ?? disk);
  const conflicts: [string, string][] = [];
  const errors: unknown[] = [];
  const origins: unknown[] = [];
  replica.doc.on("update", (_update: Uint8Array, origin: unknown) => { origins.push(origin); });
  const writer = createFileWriter({
    path: PATH, replica, files, textMerge, scheduler, copyId: () => COPY_ID,
    ...(options.persistDelayMs === undefined ? {} : { persistDelayMs: options.persistDelayMs }),
    onConflict: (path, copyPath) => { conflicts.push([path, copyPath]); },
    ...(options.reportErrors === false ? {} : { onError: (error: unknown) => { errors.push(error); } }),
  });
  return { files, scheduler, replica, writer, conflicts, errors, origins };
}

const LINES = "l1\nl2\nl3\nl4\nl5\n";

describe("createFileWriter", () => {
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
