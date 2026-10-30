/** Pins helper protocol 8: runCell and restartCell carry the cell language and note key, cellResult carries language and restarted, restartCell skips the queue, the host builds the runner with located tools and disposes it on shutdown. */
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROTOCOL_VERSION, createNativeLatexHelper, deriveHelperStatus, parseHelperMessage, type ToHelperMessage, type ToPageMessage } from "../../src/helper/index";
import { createHelperAnswerer, type HelperHandler, type HelperHandlers } from "../../src/helper/node/helperHandlers";
import { createCellHandlers, runHelperHost } from "../../src/helper/node/runHelperHost";
import * as nodeCellRunner from "../../src/qmd/compute/node/nodeCellRunner";
import * as locateToolModule from "../../src/qmd/compute/node/locateTool";
import type { CellResult, ICellRunner } from "../../src/qmd/compute/cellRunner";
import type { ILogger } from "../../src/ports/index";
import { fakeLogger, FakeHelper } from "./fakeHelperClient";

// The host builds its runner and locates tools through these two modules; the tests swap them for fakes.
jest.mock("../../src/qmd/compute/node/nodeCellRunner", () => ({ ...jest.requireActual("../../src/qmd/compute/node/nodeCellRunner"), createNodeCellRunner: jest.fn() }));
jest.mock("../../src/qmd/compute/node/locateTool", () => ({ ...jest.requireActual("../../src/qmd/compute/node/locateTool"), locateTool: jest.fn() }));

/** Runs `check` and reports any failure as "not implemented", because protocol 8 has no stub to throw it before the code exists. */
async function protocol8(check: () => unknown): Promise<void> {
  try {
    await check();
  } catch (error) {
    throw new Error(`not implemented (protocol 8): ${error instanceof Error ? error.message : String(error)}`);
  }
}

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}), redact: jest.fn() } as unknown as ILogger;
const CWD = "/work/thesis";
const resolveCwd = (scope: string): string | undefined => (scope === "thesis" ? CWD : undefined);

const env = (id: string) => ({ v: PROTOCOL_VERSION, id });
const runRaw = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ...env("run-1"), type: "runCell", code: "1+1", cwd: "thesis", timeoutMs: 60_000, language: "python", noteKey: "paper:p1", ...over });
const restartRaw = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ...env("rs-1"), type: "restartCell", noteKey: "paper:p1", language: "r", ...over });
const rejection = (raw: unknown, direction: "toHelper" | "toPage" = "toHelper") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};

interface RunCall { request: { code: string; language: string; noteKey: string }; cwd: string; timeoutMs: number; signal: AbortSignal }

/** A runner that finishes a run only when `finish` is called, or as cancelled when its signal aborts, and records restarts and disposals. */
function fakeRunner() {
  const calls: RunCall[] = [];
  const restarts: Array<[string, string]> = [];
  const finishers: Array<(result: CellResult) => void> = [];
  const dispose = jest.fn(async () => {});
  const runner = {
    run: (request: RunCall["request"], opts: { cwd: string; signal: AbortSignal; timeoutMs: number }) => new Promise<CellResult>((resolve) => {
      calls.push({ request, ...opts });
      finishers.push(resolve);
      const onAbort = () => resolve({ status: "cancelled", language: request.language, durationMs: 1 } as CellResult);
      if (opts.signal.aborted) { onAbort(); } else { opts.signal.addEventListener("abort", onAbort, { once: true }); }
    }),
    restart: async (noteKey: string, language: string) => { restarts.push([noteKey, language]); },
    dispose,
  } as unknown as ICellRunner;
  return { runner, calls, restarts, dispose, finish: (result: unknown) => finishers.shift()?.(result as CellResult) };
}

type CellHandlers = { runCell: HelperHandler; cancelCell: HelperHandler; restartCell: HelperHandler };

function setup(extra: HelperHandlers = {}) {
  const fake = fakeRunner();
  const cells = createCellHandlers({ runner: fake.runner, resolveCwd, logger }) as unknown as CellHandlers;
  const sent: Array<Record<string, unknown>> = [];
  const handlers = { runCell: cells.runCell, cancelCell: cells.cancelCell, restartCell: cells.restartCell, ...extra } as unknown as HelperHandlers;
  const dispatcher = createHelperAnswerer(handlers, logger);
  const handle = (envelope: unknown) => dispatcher.handle(envelope as Record<string, unknown>, new Uint8Array(), (m) => { sent.push(m as unknown as Record<string, unknown>); });
  return { ...fake, sent, handle, drain: () => dispatcher.drain() };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

describe("3.1a runCell and restartCell guards", () => {
  it.each(["python", "mathematica", "r"])("3.1a accepts a runCell for %s with its note key and keeps both", (language) => protocol8(() => {
    const raw = runRaw({ language, noteKey: "space:s1:notes/a.qmd" });
    expect(parseHelperMessage(JSON.parse(JSON.stringify(raw)), "toHelper")).toEqual({ ok: true, message: raw as unknown as ToHelperMessage });
  }));

  it("3.1a rejects a runCell with an unknown language", () => protocol8(() => {
    expect(rejection(runRaw({ language: "julia" }))).toBe("invalid-field");
  }));

  it("3.1a rejects a runCell without a language", () => protocol8(() => {
    const raw = runRaw();
    delete raw.language;
    expect(rejection(raw)).toBe("invalid-field");
  }));

  it("3.1a rejects a runCell without a note key", () => protocol8(() => {
    const raw = runRaw();
    delete raw.noteKey;
    expect(rejection(raw)).toBe("invalid-field");
  }));

  it("3.1a rejects a runCell with an empty note key", () => protocol8(() => {
    expect(rejection(runRaw({ noteKey: "" }))).toBeDefined();
  }));

  it("3.1a accepts a note key of 512 characters and rejects one of 513", () => protocol8(() => {
    expect(parseHelperMessage(runRaw({ noteKey: "k".repeat(512) }), "toHelper").ok).toBe(true);
    expect(rejection(runRaw({ noteKey: "k".repeat(513) }))).toBeDefined();
  }));

  it.each(["python", "mathematica", "r"])("3.1a accepts a restartCell for %s and keeps its fields", (language) => protocol8(() => {
    const raw = restartRaw({ language });
    expect(parseHelperMessage(JSON.parse(JSON.stringify(raw)), "toHelper")).toEqual({ ok: true, message: raw as unknown as ToHelperMessage });
  }));

  it("3.1a rejects a restartCell with an unknown language", () => protocol8(() => {
    expect(rejection(restartRaw({ language: "julia" }))).toBe("invalid-field");
  }));

  it("3.1a rejects a restartCell without a note key", () => protocol8(() => {
    const raw = restartRaw();
    delete raw.noteKey;
    expect(rejection(raw)).toBe("invalid-field");
  }));

  it("3.1a drops keys a restartCell does not define", () => protocol8(() => {
    const result = parseHelperMessage({ ...restartRaw(), extra: 1 }, "toHelper");
    expect(result).toEqual({ ok: true, message: restartRaw() as unknown as ToHelperMessage });
  }));

  it("3.1a refuses a restartCell sent in the page direction", () => protocol8(() => {
    expect(rejection(restartRaw(), "toPage")).toBeDefined();
    expect(parseHelperMessage(restartRaw(), "toHelper").ok).toBe(true);
  }));

  it("3.1a hands the runner the message's language and note key, with the resolved cwd and timeout", async () => protocol8(async () => {
    const h = setup();
    h.handle(runRaw({ language: "mathematica", noteKey: "project:thesis:notes.qmd", timeoutMs: 5000 }));
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.request).toEqual({ code: "1+1", language: "mathematica", noteKey: "project:thesis:notes.qmd" });
    expect(h.calls[0]).toMatchObject({ cwd: CWD, timeoutMs: 5000 });
    h.finish({ status: "ok", language: "mathematica", durationMs: 1 });
    await h.drain();
  }));

  it("3.1a answers cellResult with the language and restarted flag the runner reported", async () => protocol8(async () => {
    const h = setup();
    h.handle(runRaw({ language: "r", noteKey: "paper:p2" }));
    await until(() => h.calls.length === 1);
    h.finish({ status: "ok", language: "r", text: "[1] 2", durationMs: 9, restarted: true });
    await h.drain();
    expect(h.sent).toEqual([{ v: PROTOCOL_VERSION, id: "run-1", type: "cellResult", status: "ok", language: "r", text: "[1] 2", durationMs: 9, restarted: true }]);
  }));

  it("3.1a leaves restarted out of cellResult when the runner did not restart", async () => protocol8(async () => {
    const h = setup();
    h.handle(runRaw());
    await until(() => h.calls.length === 1);
    h.finish({ status: "ok", language: "python", latex: "2", durationMs: 3 });
    await h.drain();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: "cellResult", language: "python", latex: "2" });
    expect(h.sent[0]).not.toHaveProperty("restarted");
  }));

  it("3.1a answers a missing language as cellResult missing with that language", async () => protocol8(async () => {
    const h = setup();
    h.handle(runRaw({ language: "mathematica" }));
    await until(() => h.calls.length === 1);
    h.finish({ status: "missing", language: "mathematica", error: "wolframscript was not found", durationMs: 0 });
    await h.drain();
    expect(h.sent).toMatchObject([{ type: "cellResult", status: "missing", language: "mathematica", error: "wolframscript was not found" }]);
  }));

  it("3.1a reads cellResult with language and restarted in the page direction", () => protocol8(() => {
    const message = { ...env("run-1"), type: "cellResult", status: "ok", language: "mathematica", restarted: true, latex: "x^2", durationMs: 4 } as unknown as ToPageMessage;
    expect(parseHelperMessage(JSON.parse(JSON.stringify(message)), "toPage")).toEqual({ ok: true, message });
  }));

  it("3.1a rejects a cellResult with an unknown language", () => protocol8(() => {
    expect(rejection({ ...env("run-1"), type: "cellResult", status: "ok", language: "julia", durationMs: 4 }, "toPage")).toBe("invalid-field");
  }));

  it("3.1a sends the language and note key of a run through the client and returns the result's language and restarted flag", async () => protocol8(async () => {
    const fake = new FakeHelper();
    const helper = createNativeLatexHelper({ logger: fakeLogger(), extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket });
    await helper.connect();
    const pending = helper.runCell({ code: "1+1", cwd: "paper:p1", timeoutMs: 1000, language: "r", noteKey: "paper:p1" } as never, new AbortController().signal);
    await until(() => fake.receivedOfType("runCell").length === 1);
    const sentRun = fake.receivedOfType("runCell")[0]!;
    expect(sentRun).toMatchObject({ language: "r", noteKey: "paper:p1", cwd: "paper:p1" });
    fake.sockets[0]!.deliver({ id: sentRun.id, type: "cellResult", status: "ok", language: "r", text: "2", durationMs: 5, restarted: true });
    expect(await pending).toEqual({ status: "ok", language: "r", text: "2", durationMs: 5, restarted: true });
  }));

  it("3.1a posts a restartCell with the note key and language through the client", async () => protocol8(async () => {
    const fake = new FakeHelper();
    const helper = createNativeLatexHelper({ logger: fakeLogger(), extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket });
    await helper.connect();
    void (helper as unknown as { restartCell(noteKey: string, language: string): Promise<void> }).restartCell("paper:p1", "mathematica");
    await until(() => fake.receivedOfType("restartCell").length === 1);
    expect(fake.receivedOfType("restartCell")[0]).toMatchObject({ type: "restartCell", noteKey: "paper:p1", language: "mathematica" });
  }));
});

describe("3.1b restartCell is answered while a cell runs", () => {
  it("3.1b restarts the note's session while a run is still pending and without waiting for it", async () => protocol8(async () => {
    const h = setup();
    h.handle(runRaw());
    await until(() => h.calls.length === 1);
    h.handle(restartRaw({ noteKey: "paper:p1", language: "python" }));
    await until(() => h.restarts.length === 1);
    expect(h.restarts).toEqual([["paper:p1", "python"]]);
    expect(h.sent.filter((m) => m.type === "cellResult")).toEqual([]);
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();
  }));

  it("3.1b does not run any code for a restartCell", async () => protocol8(async () => {
    const h = setup();
    h.handle(restartRaw());
    await h.drain();
    expect(h.restarts).toEqual([["paper:p1", "r"]]);
    expect(h.calls).toEqual([]);
    expect(h.sent.filter((m) => m.type === "cellResult" || m.type === "error")).toEqual([]);
  }));

  it("3.1b handles a restartCell while another message waits in the queue behind a run", async () => protocol8(async () => {
    const closed = jest.fn(async () => {});
    const h = setup({ closeProject: closed });
    h.handle(runRaw());
    await until(() => h.calls.length === 1);
    h.handle({ ...env("close-1"), type: "closeProject", projectId: "thesis" });
    h.handle(restartRaw({ noteKey: "paper:p1", language: "python" }));
    await until(() => h.restarts.length === 1);
    expect(h.restarts).toEqual([["paper:p1", "python"]]);
    expect(closed).not.toHaveBeenCalled();
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();
    expect(closed).toHaveBeenCalledTimes(1);
  }));
});

describe("3.1c helper shutdown", () => {
  let dataDir: string;
  const mockedCreate = jest.mocked(nodeCellRunner.createNodeCellRunner);
  const mockedLocate = jest.mocked(locateToolModule.locateTool);

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "labshelf-cells-host-"));
    mockedCreate.mockReset();
    mockedLocate.mockReset();
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  async function runHost(runner: ICellRunner): Promise<void> {
    mockedCreate.mockReturnValue(runner);
    const input = new PassThrough();
    const python = { status: async () => ({ state: "missing" }), install: async () => ({ state: "missing" }) } as never;
    const done = runHelperHost({ dataDir, logger: logger as never, helperVersion: "0.4.0", host: "helper", args: [], typstWasm: async () => new Uint8Array(), input, output: new PassThrough(), python });
    input.end();
    await done;
  }

  it("3.1c disposes the runner once when the helper's input closes", async () => protocol8(async () => {
    const fake = fakeRunner();
    await runHost(fake.runner);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  }));

  it("3.1c disposes the runner before the host's promise settles", async () => protocol8(async () => {
    const fake = fakeRunner();
    let disposedAtExit: boolean | undefined;
    await runHost(fake.runner).then(() => { disposedAtExit = fake.dispose.mock.calls.length === 1; });
    expect(disposedAtExit).toBe(true);
  }));

  it("3.1c locates wolframscript for Mathematica and Rscript for R with locateTool and no override", async () => protocol8(async () => {
    await runHost(fakeRunner().runner);
    const locate = mockedCreate.mock.calls[0]![0].locate;
    expect(typeof locate).toBe("function");
    mockedLocate.mockResolvedValue("/opt/tool");
    expect(await locate!("mathematica")).toBe("/opt/tool");
    expect(await locate!("r")).toBe("/opt/tool");
    expect(mockedLocate.mock.calls.map(([tool]) => tool)).toEqual(["wolframscript", "Rscript"]);
    for (const [, options] of mockedLocate.mock.calls) { expect(options?.override).toBeUndefined(); }
  }));
});

describe("3.1d protocol version", () => {
  it("3.1d is protocol version 8", () => protocol8(() => { expect(PROTOCOL_VERSION).toBe(8); }));
});

describe("A4 protocol 8 and older helpers", () => {
  const ready = { tex: { source: "tinytex", complete: true }, helperVersion: "0.3.0", host: "vscode" } as const;

  it("A4 asks the program that a protocol 7 helper names to update", () => protocol8(() => {
    expect(deriveHelperStatus({ ...env("1"), type: "ready", protocol: 7, ...ready } as Extract<ToPageMessage, { type: "ready" }>, PROTOCOL_VERSION))
      .toEqual({ state: "update-helper", protocol: 7, host: "vscode" });
  }));

  it("A4 treats a protocol 8 helper as ready for this page", () => protocol8(() => {
    expect(deriveHelperStatus({ ...env("1"), type: "ready", protocol: 8, ...ready } as Extract<ToPageMessage, { type: "ready" }>, PROTOCOL_VERSION).state).toBe("ready");
    expect(PROTOCOL_VERSION).toBe(8);
  }));

  it("A4 refuses a hello sent with protocol version 7", () => protocol8(() => {
    const result = parseHelperMessage({ v: 7, id: "1", type: "hello", extensionVersion: "1", origin: "chrome-extension://abc" }, "toHelper");
    expect(result.ok ? undefined : result.code).toBe("version");
  }));

  it("A4 carries language, noteKey and restartCell in the same version a runCell with them is accepted", () => protocol8(() => {
    expect(PROTOCOL_VERSION).toBe(8);
    expect(parseHelperMessage(runRaw({ language: "r" }), "toHelper").ok).toBe(true);
    expect(parseHelperMessage(restartRaw(), "toHelper").ok).toBe(true);
  }));
});
