// Pins the browser cell runner: it runs a cell through ILatexHelper.runCell and hands the caller's abort signal to the helper client, which posts cancelCell.
import type { ILatexHelper } from "@labshelf/core/helper";
import { createHelperCellRunner } from "../../src/helper/cellRunner";

interface RunRequest { code: string; cwd: string; timeoutMs: number }
interface RunResult { status: string; latex?: string; text?: string; error?: string; durationMs: number }

interface FakeRun { request: RunRequest; signal: AbortSignal; resolve(result: RunResult): void; reject(error: unknown): void }

function fakeHelper() {
  const runs: FakeRun[] = [];
  const helper = {
    runCell: (request: RunRequest, signal: AbortSignal) => new Promise<RunResult>((resolve, reject) => {
      runs.push({ request, signal, resolve, reject });
    }),
  };
  return { runs, helper: helper as unknown as ILatexHelper };
}

const OPTS = (signal: AbortSignal) => ({ cwd: "project-1", signal, timeoutMs: 60_000 });

describe("createHelperCellRunner", () => {
  it("12.8a runs the code through the helper with its cwd and timeout and returns the result", async () => {
    const { helper, runs } = fakeHelper();
    const runner = createHelperCellRunner(helper);
    const pending = runner.run("print(1 + 1)\n", OPTS(new AbortController().signal));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.request).toEqual({ code: "print(1 + 1)\n", cwd: "project-1", timeoutMs: 60_000 });
    runs[0]!.resolve({ status: "ok", latex: "2", durationMs: 12 });
    await expect(pending).resolves.toEqual({ status: "ok", latex: "2", durationMs: 12 });
  });

  it("12.8a returns a missing-python result unchanged so the host can show the install prompt", async () => {
    const { helper, runs } = fakeHelper();
    const pending = createHelperCellRunner(helper).run("1", OPTS(new AbortController().signal));
    runs[0]!.resolve({ status: "missing-python", durationMs: 0 });
    await expect(pending).resolves.toEqual({ status: "missing-python", durationMs: 0 });
  });

  it("12.8a returns an error result with its error text", async () => {
    const { helper, runs } = fakeHelper();
    const pending = createHelperCellRunner(helper).run("1/0", OPTS(new AbortController().signal));
    runs[0]!.resolve({ status: "error", error: "ZeroDivisionError", durationMs: 3 });
    await expect(pending).resolves.toEqual({ status: "error", error: "ZeroDivisionError", durationMs: 3 });
  });

  it("12.8a does not abort the helper's signal while the caller's signal is live", () => {
    const { helper, runs } = fakeHelper();
    void createHelperCellRunner(helper).run("sleep()", OPTS(new AbortController().signal));
    expect(runs[0]!.signal.aborted).toBe(false);
  });

  it("12.8a aborting the caller's signal aborts the signal the helper client watches, so it posts cancelCell", () => {
    const { helper, runs } = fakeHelper();
    const controller = new AbortController();
    void createHelperCellRunner(helper).run("sleep()", OPTS(controller.signal));
    controller.abort();
    expect(runs[0]!.signal.aborted).toBe(true);
  });

  it("12.8a aborting one run does not abort another run of the same runner", () => {
    const { helper, runs } = fakeHelper();
    const runner = createHelperCellRunner(helper);
    const first = new AbortController();
    void runner.run("a", OPTS(first.signal));
    void runner.run("b", OPTS(new AbortController().signal));
    first.abort();
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(runs[1]!.signal.aborted).toBe(false);
  });

  it("12.8a hands the helper an already aborted signal when the caller aborted before running", () => {
    const { helper, runs } = fakeHelper();
    const controller = new AbortController();
    controller.abort();
    void createHelperCellRunner(helper).run("1", OPTS(controller.signal));
    expect(runs[0]!.signal.aborted).toBe(true);
  });

  it("12.8a returns the cancelled result the helper resolves with after an abort", async () => {
    const { helper, runs } = fakeHelper();
    const controller = new AbortController();
    const pending = createHelperCellRunner(helper).run("sleep()", OPTS(controller.signal));
    controller.abort();
    runs[0]!.resolve({ status: "cancelled", durationMs: 40 });
    await expect(pending).resolves.toEqual({ status: "cancelled", durationMs: 40 });
  });
});
