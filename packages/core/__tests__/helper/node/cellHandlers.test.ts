/** Pins the helper's cell handlers: a run answers cellResult under the envelope id, cancelCell aborts it by request id even while another message waits, and an unknown cwd scope is refused. */
import { PROTOCOL_VERSION, type ToHelperMessage } from "../../../src/helper/index";
import { createCellHandlers } from "../../../src/helper/node/runHelperHost";
import { createHelperAnswerer, type HelperHandlers } from "../../../src/helper/node/helperHandlers";
import type { CellResult, ICellRunner } from "../../../src/qmd/compute/cellRunner";
import type { ILogger } from "../../../src/ports/index.js";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}), redact: jest.fn() } as unknown as ILogger;
const CWD = "/work/thesis";
const resolveCwd = jest.fn((scope: string): string | undefined => (scope === "thesis" ? CWD : undefined));

interface RunCall { code: string; language: string; noteKey: string; cwd: string; timeoutMs: number; signal: AbortSignal }

/** A runner that finishes only when `finish` is called, or as cancelled when its signal aborts. */
function fakeRunner() {
  const calls: RunCall[] = [];
  const restarts: Array<{ noteKey: string; language: string }> = [];
  const finishers: Array<(result: CellResult) => void> = [];
  const runner: ICellRunner = {
    run: (request, opts) => new Promise<CellResult>((resolve) => {
      calls.push({ code: request.code, language: request.language, noteKey: request.noteKey, ...opts });
      finishers.push(resolve);
      const onAbort = () => resolve({ status: "cancelled", language: "python", durationMs: 1 });
      if (opts.signal.aborted) { onAbort(); } else { opts.signal.addEventListener("abort", onAbort, { once: true }); }
    }),
    restart: (noteKey, language) => { restarts.push({ noteKey, language }); return Promise.resolve(); },
    dispose: () => Promise.resolve(),
  };
  return { runner, calls, restarts, finish: (result: CellResult) => finishers.shift()?.(result) };
}

const runMessage = (id: string, over: Record<string, unknown> = {}): ToHelperMessage =>
  ({ v: PROTOCOL_VERSION, id, type: "runCell", code: "print(1)", cwd: "thesis", timeoutMs: 60_000, language: "python", noteKey: "notes/a.qmd", ...over }) as ToHelperMessage;
const cancelMessage = (id: string, requestId: string): ToHelperMessage => ({ v: PROTOCOL_VERSION, id, type: "cancelCell", requestId });

function setup(extra: HelperHandlers = {}) {
  const fake = fakeRunner();
  const cells = createCellHandlers({ runner: fake.runner, resolveCwd, logger });
  const sent: Array<Record<string, unknown>> = [];
  const dispatcher = createHelperAnswerer({ runCell: cells.runCell, cancelCell: cells.cancelCell, ...extra }, logger);
  const send = (envelope: Record<string, unknown>) => { sent.push(envelope); };
  const handle = (envelope: unknown) => dispatcher.handle(envelope as Record<string, unknown>, new Uint8Array(), send);
  return { ...fake, cells, sent, handle, drain: () => dispatcher.drain() };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

beforeEach(() => { jest.clearAllMocks(); });

describe("12.4b runCell and cancelCell handlers", () => {
  it("12.4b runs the code with the resolved cwd and timeout and answers cellResult under the envelope id", async () => {
    const h = setup();
    h.handle(runMessage("run-1", { timeoutMs: 5000, language: "r", noteKey: "notes/b.qmd" }));
    await until(() => h.calls.length === 1);
    expect(h.calls[0]).toMatchObject({ code: "print(1)", language: "r", noteKey: "notes/b.qmd", cwd: CWD, timeoutMs: 5000 });
    expect(h.calls[0]!.signal.aborted).toBe(false);
    h.finish({ status: "ok", language: "r", latex: "x^{2}", text: "x**2", durationMs: 42 });
    await h.drain();
    expect(h.sent).toEqual([{ v: PROTOCOL_VERSION, id: "run-1", type: "cellResult", status: "ok", language: "r", latex: "x^{2}", text: "x**2", durationMs: 42 }]);
  });

  it("12.4b carries an error result through unchanged", async () => {
    const h = setup();
    h.handle(runMessage("run-2"));
    await until(() => h.calls.length === 1);
    h.finish({ status: "error", language: "python", error: "NameError: y", durationMs: 7 });
    await h.drain();
    expect(h.sent).toMatchObject([{ id: "run-2", type: "cellResult", status: "error", error: "NameError: y", durationMs: 7 }]);
  });

  it("12.4b aborts the run signal of the request id named by cancelCell and answers the run as cancelled", async () => {
    const h = setup();
    h.handle(runMessage("run-3"));
    await until(() => h.calls.length === 1);
    h.handle(cancelMessage("c-3", "run-3"));
    await h.drain();
    expect(h.calls[0]!.signal.aborted).toBe(true);
    expect(h.sent).toContainEqual(expect.objectContaining({ id: "run-3", type: "cellResult", status: "cancelled" }));
  });

  it("12.4b registers the abort controller before any await, so a cancelCell right behind the run reaches it", async () => {
    const h = setup();
    const pending = h.cells.runCell(runMessage("run-4"), (m) => { h.sent.push(m as unknown as Record<string, unknown>); });
    await h.cells.cancelCell(cancelMessage("c-4", "run-4"), () => {});
    await pending;
    expect(h.calls[0]?.signal.aborted).toBe(true);
    expect(h.sent).toContainEqual(expect.objectContaining({ id: "run-4", type: "cellResult", status: "cancelled" }));
  });

  it("12.4b cancels a run by request id while another message waits in the queue", async () => {
    const closed = jest.fn(async () => {});
    const h = setup({ closeProject: closed });
    h.handle(runMessage("run-5"));
    await until(() => h.calls.length === 1);
    h.handle({ v: PROTOCOL_VERSION, id: "close-1", type: "closeProject", projectId: "thesis" });
    h.handle(cancelMessage("c-5", "run-5"));
    await h.drain();
    expect(h.calls[0]!.signal.aborted).toBe(true);
    expect(h.sent).toContainEqual(expect.objectContaining({ id: "run-5", type: "cellResult", status: "cancelled" }));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("12.4b does not fail the dispatcher on a cancelCell for a request id that is not running", async () => {
    const h = setup();
    h.handle(cancelMessage("c-6", "nothing"));
    await h.drain();
    expect(h.sent.filter((m) => m.type === "cellResult")).toEqual([]);
  });
});

describe("12.4c unknown cwd scope", () => {
  it("12.4c refuses an unknown scope with an error reply under the request id and does not run the code", async () => {
    const h = setup();
    h.handle(runMessage("run-7", { cwd: "ghost" }));
    await h.drain();
    expect(resolveCwd).toHaveBeenCalledWith("ghost");
    expect(h.calls).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ v: PROTOCOL_VERSION, id: "run-7", type: "error" });
    expect(h.sent.some((m) => m.type === "cellResult")).toBe(false);
  });

  it("12.4c still runs a known scope after an unknown one was refused", async () => {
    const h = setup();
    h.handle(runMessage("run-8", { cwd: "ghost" }));
    h.handle(runMessage("run-9", { cwd: "thesis" }));
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.cwd).toBe(CWD);
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();
    expect(h.sent.map((m) => [m.id, m.type])).toEqual([["run-8", "error"], ["run-9", "cellResult"]]);
  });
});
