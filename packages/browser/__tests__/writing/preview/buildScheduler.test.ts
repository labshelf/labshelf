// Pins when the preview asks the helper for builds: debounced previews, full builds on save and idle, cancels and the auto-compile modes.
import type { AutoCompileMode, ILogger } from "@labshelf/core";
import type { HelperCompileRequest, HelperCompileResult } from "@labshelf/core/helper";
import { createBuildScheduler, type BuildTimers } from "../../../src/writing/preview";

interface FakeTimer { at: number; fn: () => void; id: number }

function fakeTimers(): BuildTimers & { advance(ms: number): void } {
  let now = 0;
  let nextId = 1;
  let pending: FakeTimer[] = [];
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.push({ at: now + ms, fn, id }); return id; },
    clearTimeout(id) { pending = pending.filter((t) => t.id !== id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = pending.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        pending = pending.filter((t) => t !== due);
        now = due.at;
        due.fn();
      }
      now = end;
    },
  };
}

const RESULT: HelperCompileResult = { status: "succeeded", problems: [], pageCount: 1, changed: [] };
const logger: ILogger = { log: async () => undefined, error: async () => undefined } as unknown as ILogger;

function setup(mode: AutoCompileMode = "typing") {
  const timers = fakeTimers();
  const requests: HelperCompileRequest[] = [];
  const resolvers: ((r: HelperCompileResult) => void)[] = [];
  const rejects: ((error: Error) => void)[] = [];
  const cancels: string[] = [];
  const results: { mode: string; result: HelperCompileResult }[] = [];
  const helper = {
    compile: (req: HelperCompileRequest) => {
      requests.push(req);
      return new Promise<HelperCompileResult>((resolve, reject) => { resolvers.push(resolve); rejects.push(reject); });
    },
    cancel: async (projectId: string) => { cancels.push(projectId); },
  };
  const scheduler = createBuildScheduler({
    onStart: jest.fn(),
    helper, target: { projectId: "p1", main: "main.tex", engine: "pdflatex" }, mode, timers, logger,
    onResult: (result, mode) => results.push({ mode, result }),
  });
  return { timers, requests, resolvers, rejects, cancels, results, scheduler };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createBuildScheduler", () => {
  it("builds a preview of the edited file after 500 ms without edits", () => {
    const { timers, requests, scheduler } = setup();
    scheduler.edit("a.tex");
    timers.advance(400);
    scheduler.edit("b.tex", 7);
    timers.advance(499);
    expect(requests).toEqual([]);
    timers.advance(1);
    expect(requests).toEqual([{ projectId: "p1", main: "main.tex", engine: "pdflatex", mode: "preview", editedFile: "b.tex", editedLine: 7 }]);
  });

  it("builds in full right away on save, dropping the pending preview", () => {
    const { timers, requests, scheduler } = setup();
    scheduler.edit("a.tex");
    scheduler.save(false);
    expect(requests.map((r) => r.mode)).toEqual(["full"]);
    timers.advance(5000);
    expect(requests.map((r) => r.mode)).toEqual(["full"]);
  });

  it("builds in full after 2 s without edits", async () => {
    const { timers, requests, resolvers, scheduler } = setup();
    scheduler.edit("a.tex");
    timers.advance(500);
    resolvers[0]!(RESULT);
    await flush();
    timers.advance(1499);
    expect(requests.map((r) => r.mode)).toEqual(["preview"]);
    timers.advance(1);
    expect(requests.map((r) => r.mode)).toEqual(["preview", "full"]);
    expect(requests[1]!.editedFile).toBeUndefined();
    expect(requests[1]!.editedLine).toBeUndefined();
  });

  it("cancels the running build on a new edit and drops its result", async () => {
    const { timers, requests, resolvers, cancels, results, scheduler } = setup();
    scheduler.edit("a.tex");
    timers.advance(500);
    scheduler.edit("a.tex");
    expect(cancels).toEqual(["p1"]);
    resolvers[0]!({ ...RESULT, status: "cancelled" });
    await flush();
    expect(results).toEqual([]);
    timers.advance(500);
    expect(requests.map((r) => r.mode)).toEqual(["preview", "preview"]);
    resolvers[1]!(RESULT);
    await flush();
    expect(results).toEqual([{ mode: "preview", result: RESULT }]);
  });

  it("stops scheduling after dispose", () => {
    const { timers, requests, scheduler } = setup();
    scheduler.edit("a.tex");
    scheduler.dispose();
    timers.advance(5000);
    expect(requests).toEqual([]);
  });
});


describe("build completion", () => {
  it("keeps a full build running when recompile is requested repeatedly without edits", async () => {
    const { scheduler, requests, resolvers, cancels, results } = setup();
    scheduler.build();
    scheduler.build();
    scheduler.build();
    expect(requests).toHaveLength(1);
    expect(cancels).toEqual([]);
    resolvers[0]!(RESULT);
    await flush();
    expect(results).toEqual([{ mode: "full", result: RESULT }]);
    scheduler.save(false);
    expect(requests).toHaveLength(2);
  });

  it("reports a failed build when the helper rejects, allowing a retry", async () => {
    const { scheduler, rejects, results, requests } = setup();
    scheduler.save(false);
    rejects[0]!(new Error("Helper disconnected"));
    await flush();
    expect(results).toEqual([{ mode: "full", result: {
      status: "failed", changed: [], problems: [{ severity: "error", file: "main.tex", message: "Helper disconnected" }],
    } }]);
    scheduler.save(false);
    expect(requests).toHaveLength(2);
  });
});


it("allows a full build of edited sources to supersede an active full build", async () => {
  const { scheduler, requests, rejects, resolvers, cancels, results } = setup();
  scheduler.save(false);
  scheduler.edit("main.tex", 5);
  scheduler.save(false);
  expect(requests).toHaveLength(2);
  expect(cancels).toEqual(["p1"]);
  rejects[0]!(new Error("Superseded request disconnected"));
  resolvers[1]!(RESULT);
  await flush();
  expect(results).toEqual([{ mode: "full", result: RESULT }]);
});


it("lets a preview finish before an automatic save starts the full build", async () => {
  const { scheduler, timers, requests, resolvers, cancels, results } = setup();
  scheduler.edit("main.tex", 3);
  timers.advance(500);
  scheduler.save(false);
  scheduler.save(false);
  expect(requests.map((request) => request.mode)).toEqual(["preview"]);
  expect(cancels).toEqual([]);
  resolvers[0]!(RESULT);
  await flush();
  expect(results).toEqual([{ mode: "preview", result: RESULT }]);
  expect(requests.map((request) => request.mode)).toEqual(["preview", "full"]);
});


describe("auto-compile modes", () => {
  it("builds nothing on edits or autosaves in save mode, and in full on an explicit save", () => {
    const { timers, requests, scheduler } = setup("save");
    scheduler.edit("a.tex");
    timers.advance(5000);
    scheduler.save(false);
    expect(requests).toEqual([]);
    scheduler.save(true);
    expect(requests.map((r) => r.mode)).toEqual(["full"]);
  });

  it("builds only on recompile in off mode", () => {
    const { timers, requests, scheduler } = setup("off");
    scheduler.edit("a.tex");
    timers.advance(5000);
    scheduler.save(true);
    expect(requests).toEqual([]);
    scheduler.build();
    expect(requests.map((r) => r.mode)).toEqual(["full"]);
  });

  it("follows a mode change for the next edit, dropping builds the old mode scheduled", () => {
    const { timers, requests, scheduler } = setup();
    scheduler.edit("a.tex");
    scheduler.setMode("off");
    timers.advance(5000);
    expect(requests).toEqual([]);
    scheduler.setMode("typing");
    scheduler.edit("a.tex");
    timers.advance(500);
    expect(requests.map((r) => r.mode)).toEqual(["preview"]);
  });

  it("sends a changed target with the next build", () => {
    const { requests, scheduler } = setup();
    scheduler.setTarget({ engine: "xelatex", haltOnError: true });
    scheduler.build();
    expect(requests).toEqual([{ projectId: "p1", main: "main.tex", engine: "xelatex", haltOnError: true, mode: "full" }]);
  });
});
