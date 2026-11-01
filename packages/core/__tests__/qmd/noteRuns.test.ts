// Tests the note-run coordinator (spec 2.1): scopes, sequential awaiting, stop at the first non-ok end, queue states, one flush, refused second run, stop(), and progress ending in null.
// Written as if the file sat at packages/core/__tests__/qmd/noteRuns.test.ts; imports only the seams of src/qmd/noteRuns.ts.
import { createNoteRuns, type CellRunEnd, type NotebookCell, type NoteRunsOptions } from "../../src/qmd/noteRuns";

type Progress = { done: number; total: number; running: string | null } | null;
type Queue = "queued" | "not-run" | null;

interface Fake extends NotebookCell {
  /** Resolve the pending run() with an end state. */
  finish(end: CellRunEnd): void;
  readonly queue: Queue[];
  readonly runs: number;
  readonly cancels: number;
}

/** Shared event log, in call order: "run:<key>", "cancel:<key>", "queue:<key>:<state>", "flush", "restart:<lang>". */
type Log = string[];

interface FakeSpec {
  key: string;
  language?: string;
  sections?: string[];
  /** Resolve at once with this end; omitted means the run stays pending until finish(). */
  end?: CellRunEnd;
}

function fakeCell(spec: FakeSpec, log: Log): Fake {
  let resolve: ((end: CellRunEnd) => void) | null = null;
  const queue: Queue[] = [];
  let runs = 0;
  let cancels = 0;
  return {
    key: spec.key,
    itemId: "item-1",
    language: spec.language ?? "python",
    sectionKeys: spec.sections ?? [],
    run() {
      runs += 1;
      log.push(`run:${spec.key}`);
      if (spec.end) return Promise.resolve(spec.end);
      return new Promise<CellRunEnd>((r) => {
        resolve = r;
      });
    },
    cancel() {
      cancels += 1;
      log.push(`cancel:${spec.key}`);
      resolve?.("cancelled");
    },
    setQueue(state) {
      queue.push(state);
      log.push(`queue:${spec.key}:${state}`);
    },
    finish(end) {
      if (!resolve) throw new Error(`cell ${spec.key} has no pending run`);
      resolve(end);
    },
    queue,
    get runs() {
      return runs;
    },
    get cancels() {
      return cancels;
    },
  };
}

/** Lets pending promise continuations run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface Setup {
  cells: Fake[];
  log: Log;
  progress: Progress[];
  flush: jest.Mock;
  restart: jest.Mock;
  runs: ReturnType<typeof createNoteRuns>;
  options: NoteRunsOptions;
  list: { current: Fake[] };
}

function setup(specs: FakeSpec[], over: Partial<NoteRunsOptions> = {}, withProgress = true): Setup {
  const log: Log = [];
  const cells = specs.map((s) => fakeCell(s, log));
  const list = { current: cells };
  const progress: Progress[] = [];
  const flush = jest.fn(() => {
    log.push("flush");
  });
  const restart = jest.fn(async (language: string) => {
    log.push(`restart:${language}`);
  });
  const options: NoteRunsOptions = {
    cells: () => list.current,
    flush,
    restart,
    ...(withProgress ? { onProgress: (p: Progress) => void progress.push(p) } : {}),
    ...over,
  };
  return { cells, log, progress, flush, restart, runs: createNoteRuns(options), options, list };
}

function at(s: Setup, i: number): Fake {
  const cell = s.cells[i];
  if (!cell) throw new Error(`no fake cell ${i}`);
  return cell;
}
const ran = (s: Setup) => s.cells.filter((c) => c.runs > 0).map((c) => c.key);

describe("noteRuns", () => {
  test("2.1a all runs every cell once in note order", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "ok" }, { key: "c", end: "ok" }]);
    const result = await s.runs.run({ kind: "all" });
    expect(s.log.filter((e) => e.startsWith("run:"))).toEqual(["run:a", "run:b", "run:c"]);
    expect(s.cells.map((c) => c.runs)).toEqual([1, 1, 1]);
    expect(result).toEqual({ ran: 3, stoppedAt: null, end: "ok" });
  });

  test("2.1a the second cell starts only after the first resolves", async () => {
    const s = setup([{ key: "a" }, { key: "b" }]);
    const done = s.runs.run({ kind: "all" });
    await tick();
    expect(ran(s)).toEqual(["a"]);
    await tick();
    expect(ran(s)).toEqual(["a"]);
    at(s, 0).finish("ok");
    await tick();
    expect(ran(s)).toEqual(["a", "b"]);
    at(s, 1).finish("ok");
    await expect(done).resolves.toMatchObject({ stoppedAt: null, end: "ok" });
  });

  test("2.1a running is true while a run is pending and false after", async () => {
    const s = setup([{ key: "a" }]);
    expect(s.runs.running).toBe(false);
    const done = s.runs.run({ kind: "all" });
    await tick();
    expect(s.runs.running).toBe(true);
    at(s, 0).finish("ok");
    await done;
    expect(s.runs.running).toBe(false);
  });

  test("2.1a cells() is read when a run starts", async () => {
    const s = setup([{ key: "a", end: "ok" }]);
    const later = [fakeCell({ key: "x", end: "ok" }, s.log), fakeCell({ key: "y", end: "ok" }, s.log)];
    s.list.current = later;
    const result = await s.runs.run({ kind: "all" });
    expect(at(s, 0).runs).toBe(0);
    expect(later.map((c) => c.runs)).toEqual([1, 1]);
    expect(result.ran).toBe(2);
  });

  test("2.1b above runs every cell before the named one, exclusive", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "ok" }, { key: "c", end: "ok" }, { key: "d", end: "ok" }]);
    const result = await s.runs.run({ kind: "above", cell: "c" });
    expect(ran(s)).toEqual(["a", "b"]);
    expect(result.ran).toBe(2);
  });

  test("2.1b below runs the named cell and all after it", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "ok" }, { key: "c", end: "ok" }, { key: "d", end: "ok" }]);
    const result = await s.runs.run({ kind: "below", cell: "b" });
    expect(ran(s)).toEqual(["b", "c", "d"]);
    expect(result.ran).toBe(3);
  });

  test("2.1b section runs the cells whose sectionKeys include the key, in note order", async () => {
    const s = setup([
      { key: "a", sections: [] },
      { key: "b", sections: ["1:Intro:0"] },
      { key: "c", sections: ["1:Intro:0", "2:Setup:0"] },
      { key: "d", sections: ["1:Other:0"] },
      { key: "e", sections: ["1:Intro:0"] },
    ].map((c) => ({ ...c, end: "ok" as const })));
    await s.runs.run({ kind: "section", section: "1:Intro:0" });
    expect(s.log.filter((e) => e.startsWith("run:"))).toEqual(["run:b", "run:c", "run:e"]);
    expect(at(s, 0).queue).toEqual([]);
    expect(at(s, 3).queue).toEqual([]);
  });

  test("2.1b a nested section key selects only its own cells", async () => {
    const s = setup([
      { key: "a", sections: ["1:Intro:0"], end: "ok" },
      { key: "b", sections: ["1:Intro:0", "2:Setup:0"], end: "ok" },
    ]);
    await s.runs.run({ kind: "section", section: "2:Setup:0" });
    expect(ran(s)).toEqual(["b"]);
  });

  test("2.1b restartAll restarts each language once, in first-appearance order, then runs all", async () => {
    const s = setup([
      { key: "a", language: "python", end: "ok" },
      { key: "b", language: "r", end: "ok" },
      { key: "c", language: "python", end: "ok" },
      { key: "d", language: "wolfram", end: "ok" },
      { key: "e", language: "r", end: "ok" },
    ]);
    const result = await s.runs.run({ kind: "restartAll" });
    expect(s.restart.mock.calls.map((c) => c[0])).toEqual(["python", "r", "wolfram"]);
    const firstRun = s.log.findIndex((e) => e.startsWith("run:"));
    const lastRestart = s.log.map((e) => e.startsWith("restart:")).lastIndexOf(true);
    expect(lastRestart).toBeGreaterThanOrEqual(0);
    expect(lastRestart).toBeLessThan(firstRun);
    expect(s.log.filter((e) => e.startsWith("run:"))).toEqual(["run:a", "run:b", "run:c", "run:d", "run:e"]);
    expect(result.ran).toBe(5);
  });

  test("2.1b restartAll waits for a slow restart before running any cell", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = setup([{ key: "a", end: "ok" }], { restart: jest.fn(() => gate) });
    const done = s.runs.run({ kind: "restartAll" });
    await tick();
    expect(at(s, 0).runs).toBe(0);
    release();
    await done;
    expect(at(s, 0).runs).toBe(1);
  });

  test("2.1b scopes other than restartAll do not restart", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "ok" }]);
    await s.runs.run({ kind: "all" });
    await s.runs.run({ kind: "below", cell: "b" });
    expect(s.restart).not.toHaveBeenCalled();
  });

  test("2.1c an error in cell 2 of 4 stops the run and cells 3 and 4 never run", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "error" }, { key: "c", end: "ok" }, { key: "d", end: "ok" }]);
    const result = await s.runs.run({ kind: "all" });
    expect(ran(s)).toEqual(["a", "b"]);
    expect(result.stoppedAt).toBe("b");
    expect(result.end).toBe("error");
  });

  test("2.1c cells 3 and 4 get not-run and the cells that ran do not", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "error" }, { key: "c", end: "ok" }, { key: "d", end: "ok" }]);
    await s.runs.run({ kind: "all" });
    expect(at(s, 0).queue).toEqual(["queued", null]);
    expect(at(s, 1).queue).toEqual(["queued", null]);
    expect(at(s, 2).queue).toEqual(["queued", "not-run"]);
    expect(at(s, 3).queue).toEqual(["queued", "not-run"]);
  });

  test("2.1c a missing end also stops the run at that cell", async () => {
    const s = setup([{ key: "a", end: "missing" }, { key: "b", end: "ok" }]);
    const result = await s.runs.run({ kind: "all" });
    expect(ran(s)).toEqual(["a"]);
    expect(result).toMatchObject({ stoppedAt: "a", end: "missing" });
    expect(at(s, 1).queue).toEqual(["queued", "not-run"]);
  });

  test("2.1c a cancelled end of a cell stops the run at that cell", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "cancelled" }, { key: "c", end: "ok" }]);
    const result = await s.runs.run({ kind: "all" });
    expect(ran(s)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ stoppedAt: "b", end: "cancelled" });
    expect(at(s, 2).queue).toEqual(["queued", "not-run"]);
  });

  test("2.1c an error in the last cell leaves nothing to mark not-run", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "error" }]);
    const result = await s.runs.run({ kind: "all" });
    expect(result).toMatchObject({ stoppedAt: "b", end: "error" });
    expect(s.cells.flatMap((c) => c.queue)).not.toContain("not-run");
  });

  test("2.1d stop() cancels the running cell and clears the queue of the others", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b" }, { key: "c" }, { key: "d" }]);
    const done = s.runs.run({ kind: "all" });
    await tick();
    expect(ran(s)).toEqual(["a", "b"]);
    s.runs.stop();
    const result = await done;
    expect(at(s, 1).cancels).toBe(1);
    expect(at(s, 0).cancels + at(s, 2).cancels + at(s, 3).cancels).toBe(0);
    expect(at(s, 2).queue).toEqual(["queued", null]);
    expect(at(s, 3).queue).toEqual(["queued", null]);
    expect(result.end).toBe("cancelled");
  });

  test("2.1d after stop() the later cells never run and are not marked not-run", async () => {
    const s = setup([{ key: "a" }, { key: "b", end: "ok" }, { key: "c", end: "ok" }]);
    const done = s.runs.run({ kind: "all" });
    await tick();
    s.runs.stop();
    await done;
    await tick();
    expect(ran(s)).toEqual(["a"]);
    expect(s.cells.flatMap((c) => c.queue)).not.toContain("not-run");
    expect(s.runs.running).toBe(false);
  });

  test("2.1d stop() with nothing running does nothing", async () => {
    const s = setup([{ key: "a", end: "ok" }]);
    expect(() => s.runs.stop()).not.toThrow();
    expect(at(s, 0).cancels).toBe(0);
    const result = await s.runs.run({ kind: "all" });
    expect(result).toMatchObject({ end: "ok", stoppedAt: null });
  });

  test("2.1d a run can start again after stop()", async () => {
    const s = setup([{ key: "a" }]);
    const first = s.runs.run({ kind: "all" });
    await tick();
    s.runs.stop();
    await first;
    const second = s.runs.run({ kind: "all" });
    await tick();
    expect(at(s, 0).runs).toBe(2);
    at(s, 0).finish("ok");
    await expect(second).resolves.toMatchObject({ end: "ok" });
  });

  test("A2 scopes in note order, stop at first error, Not run after", async () => {
    const s = setup([
      { key: "a", sections: ["1:H:0"], end: "ok" },
      { key: "b", sections: ["1:H:0"], end: "error" },
      { key: "c", sections: ["1:H:0"], end: "ok" },
      { key: "d", sections: [], end: "ok" },
    ]);
    const result = await s.runs.run({ kind: "section", section: "1:H:0" });
    expect(s.log.filter((e) => e.startsWith("run:"))).toEqual(["run:a", "run:b"]);
    expect(result).toMatchObject({ stoppedAt: "b", end: "error" });
    expect(at(s, 2).queue).toEqual(["queued", "not-run"]);
    expect(at(s, 3).queue).toEqual([]);
  });

  test("flush is called once per run, before any cell runs", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "ok" }, { key: "c", end: "ok" }]);
    await s.runs.run({ kind: "all" });
    expect(s.flush).toHaveBeenCalledTimes(1);
    const firstRun = s.log.findIndex((e) => e.startsWith("run:"));
    expect(s.log.indexOf("flush")).toBeLessThan(firstRun);
  });

  test("flush is called once per run for restartAll too", async () => {
    const s = setup([{ key: "a", language: "python", end: "ok" }, { key: "b", language: "r", end: "ok" }]);
    await s.runs.run({ kind: "restartAll" });
    expect(s.flush).toHaveBeenCalledTimes(1);
  });

  test("an async flush finishes before the first cell runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = setup([{ key: "a", end: "ok" }], { flush: jest.fn(() => gate) });
    const done = s.runs.run({ kind: "all" });
    await tick();
    expect(at(s, 0).runs).toBe(0);
    release();
    await done;
    expect(at(s, 0).runs).toBe(1);
  });

  test("every cell of the scope is queued at the start, before the first runs", async () => {
    const s = setup([{ key: "a" }, { key: "b" }, { key: "c" }]);
    const done = s.runs.run({ kind: "below", cell: "b" });
    await tick();
    const firstRun = s.log.findIndex((e) => e.startsWith("run:"));
    const before = s.log.slice(0, firstRun);
    expect(before).toContain("queue:b:queued");
    expect(before).toContain("queue:c:queued");
    expect(at(s, 0).queue).toEqual([]);
    s.runs.stop();
    await done;
  });

  test("a cell's queue is cleared with null just before it runs", async () => {
    const s = setup([{ key: "a", end: "ok" }, { key: "b", end: "ok" }]);
    await s.runs.run({ kind: "all" });
    const log = s.log;
    expect(log.indexOf("queue:a:null")).toBeLessThan(log.indexOf("run:a"));
    expect(log.indexOf("queue:b:null")).toBeLessThan(log.indexOf("run:b"));
    expect(log.indexOf("queue:b:null")).toBeGreaterThan(log.indexOf("run:a"));
    expect(at(s, 0).queue).toEqual(["queued", null]);
    expect(at(s, 1).queue).toEqual(["queued", null]);
  });

  test("a second run while one runs is refused and returns the first's result", async () => {
    const s = setup([{ key: "a" }, { key: "b" }]);
    const first = s.runs.run({ kind: "all" });
    await tick();
    const second = s.runs.run({ kind: "below", cell: "b" });
    await tick();
    expect(s.flush).toHaveBeenCalledTimes(1);
    expect(s.cells.map((c) => c.runs)).toEqual([1, 0]);
    at(s, 0).finish("ok");
    await tick();
    at(s, 1).finish("ok");
    const [r1, r2] = await Promise.all([first, second]);
    expect(r2).toEqual(r1);
    expect(r1).toMatchObject({ ran: 2, end: "ok" });
    expect(s.cells.map((c) => c.runs)).toEqual([1, 1]);
  });

  test("a run after the previous one finished is accepted", async () => {
    const s = setup([{ key: "a", end: "ok" }]);
    await s.runs.run({ kind: "all" });
    await s.runs.run({ kind: "all" });
    expect(at(s, 0).runs).toBe(2);
    expect(s.flush).toHaveBeenCalledTimes(2);
  });

  test("onProgress reports the running cell and ends with null", async () => {
    const s = setup([{ key: "a" }, { key: "b" }, { key: "c" }]);
    const done = s.runs.run({ kind: "all" });
    await tick();
    at(s, 0).finish("ok");
    await tick();
    at(s, 1).finish("ok");
    await tick();
    at(s, 2).finish("ok");
    await done;
    const real = s.progress.filter((p): p is NonNullable<Progress> => p !== null);
    expect(real.length).toBeGreaterThan(0);
    expect(real.every((p) => p.total === 3)).toBe(true);
    expect(real.find((p) => p.running === "a")).toMatchObject({ done: 0, total: 3 });
    expect(real.find((p) => p.running === "b")).toMatchObject({ done: 1, total: 3 });
    expect(real.find((p) => p.running === "c")).toMatchObject({ done: 2, total: 3 });
    expect(s.progress[s.progress.length - 1]).toBeNull();
    expect(s.progress.slice(0, -1).every((p) => p !== null)).toBe(true);
  });

  test("onProgress ends with null after an error stop", async () => {
    const s = setup([{ key: "a", end: "error" }, { key: "b", end: "ok" }]);
    await s.runs.run({ kind: "all" });
    expect(s.progress[s.progress.length - 1]).toBeNull();
  });

  test("onProgress ends with null after stop()", async () => {
    const s = setup([{ key: "a" }, { key: "b" }]);
    const done = s.runs.run({ kind: "all" });
    await tick();
    s.runs.stop();
    await done;
    expect(s.progress[s.progress.length - 1]).toBeNull();
  });

  test("a run works without onProgress", async () => {
    const s = setup([{ key: "a", end: "ok" }], {}, false);
    await expect(s.runs.run({ kind: "all" })).resolves.toMatchObject({ end: "ok" });
  });
});
