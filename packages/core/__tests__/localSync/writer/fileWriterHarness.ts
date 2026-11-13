// Fakes and builders shared by the createFileWriter tests: a manual scheduler, in-memory files with an operation log, a replica and the writer setup.
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };
import * as Y from "yjs";

import type { SessionScheduler } from "../../../src/collab/channel.js";
import { createFileWriter, type FileWriter } from "../../../src/localSync/writer/fileWriter.js";
import type { FileStat, WriterFiles, WriterReplica } from "../../../src/localSync/writer/ports.js";
import { createTextMerge } from "../../../src/writing/textMerge.js";

// node-diff3 ships ESM types only; its `require` export is the CommonJS build Jest loads (as itemFileMerge.ts does).
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;
const textMerge = createTextMerge(diff3Merge);

export const PATH = "paper/main.tex";
export const COPY_ID = "11111111-2222-4333-8444-555555555555";
export const COPY_PATH = `${PATH}.labshelf-conflict-${COPY_ID}`;
export const MARKERS = /^(<<<<<<<|=======|>>>>>>>)/m;

export const settle = async (): Promise<void> => { for (let i = 0; i < 3; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); } };

/** A manual clock: timers fire only when advance() moves time past them. */
export class ManualScheduler implements SessionScheduler {
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

export type Kind = "read" | "stat" | "write";

/** In-memory files that log every call, count calls in flight, and can hold or fail the next call of a kind. */
export class FakeFiles implements WriterFiles {
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
export function makeReplica(initial: string): WriterReplica {
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

export interface Setup {
  files: FakeFiles;
  scheduler: ManualScheduler;
  replica: WriterReplica;
  writer: FileWriter;
  conflicts: [string, string][];
  errors: unknown[];
  origins: unknown[];
}

export function setup(options: { disk?: string; doc?: string; persistDelayMs?: number; reportErrors?: boolean } = {}): Setup {
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

export const LINES = "l1\nl2\nl3\nl4\nl5\n";
