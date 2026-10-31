/** Pins helper protocol 10: runCell carries preview, cellResult carries plot, through the parser, the helper host and the page client. */
import { PROTOCOL_VERSION, createNativeLatexHelper, parseHelperMessage, type ToHelperMessage, type ToPageMessage } from "../../../src/helper/index";
import { createHelperAnswerer, type HelperHandler, type HelperHandlers } from "../../../src/helper/node/helperHandlers";
import { createCellHandlers } from "../../../src/helper/node/runHelperHost";
import type { CellResult, ICellRunner } from "../../../src/qmd/compute/cellRunner";
import type { ILogger } from "../../../src/ports/index";
import { fakeLogger, FakeHelper } from "../fakeHelperClient";

/** Runs `check` and reports any failure as "not implemented", because spec 3.2 has no stub to throw it before the code exists. */
async function spec32(check: () => unknown): Promise<void> {
  try {
    await check();
  } catch (error) {
    throw new Error(`not implemented: 3.2: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}), redact: jest.fn() } as unknown as ILogger;
const CWD = "/work/thesis";
const resolveCwd = (scope: string): string | undefined => (scope === "thesis" ? CWD : undefined);
const PLOT = JSON.stringify({ format: "labshelf-plot", version: 1, traces: [{ type: "scatter", x: [1, 2], y: [3, 4] }] });

const env = (id: string) => ({ v: PROTOCOL_VERSION, id });
const runRaw = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ...env("run-1"), type: "runCell", code: "1+1", cwd: "thesis", timeoutMs: 60_000, language: "python", noteKey: "paper:p1", ...over });
const resultRaw = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ...env("run-1"), type: "cellResult", status: "ok", language: "python", durationMs: 4, ...over });
const rejection = (raw: unknown, direction: "toHelper" | "toPage") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};

interface RunCall { request: Record<string, unknown>; cwd: string; timeoutMs: number; signal: AbortSignal }

/** A runner that finishes a run only when `finish` is called. */
function fakeRunner() {
  const calls: RunCall[] = [];
  const finishers: Array<(result: CellResult) => void> = [];
  const runner = {
    run: (request: RunCall["request"], opts: { cwd: string; signal: AbortSignal; timeoutMs: number }) => new Promise<CellResult>((resolve) => {
      calls.push({ request, ...opts });
      finishers.push(resolve);
    }),
    restart: async () => {},
    dispose: async () => {},
  } as unknown as ICellRunner;
  return { runner, calls, finish: (result: unknown) => finishers.shift()?.(result as CellResult) };
}

function setup() {
  const fake = fakeRunner();
  const cells = createCellHandlers({ runner: fake.runner, resolveCwd, logger }) as unknown as { runCell: HelperHandler };
  const sent: Array<Record<string, unknown>> = [];
  const dispatcher = createHelperAnswerer({ runCell: cells.runCell } as unknown as HelperHandlers, logger);
  const handle = (envelope: unknown) => dispatcher.handle(envelope as Record<string, unknown>, new Uint8Array(), (m) => { sent.push(m as unknown as Record<string, unknown>); });
  return { ...fake, sent, handle, drain: () => dispatcher.drain() };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

async function connected() {
  const fake = new FakeHelper();
  const helper = createNativeLatexHelper({ logger: fakeLogger(), extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket });
  await helper.connect();
  return { fake, helper };
}

describe("3.2a protocol 10 messages", () => {
  it("3.2a PROTOCOL_VERSION is 10", () => spec32(() => {
    expect(PROTOCOL_VERSION).toBe(10);
  }));

  it.each([true, false])("3.2a accepts a runCell with preview %s and keeps it", (preview) => spec32(() => {
    const raw = runRaw({ preview });
    expect(parseHelperMessage(JSON.parse(JSON.stringify(raw)), "toHelper")).toEqual({ ok: true, message: raw as unknown as ToHelperMessage });
  }));

  it("3.2a accepts a runCell without preview and adds none", () => spec32(() => {
    expect(parseHelperMessage(runRaw({ preview: true }), "toHelper")).toEqual({ ok: true, message: runRaw({ preview: true }) as unknown as ToHelperMessage });
    const plain = parseHelperMessage(runRaw(), "toHelper");
    expect(plain).toEqual({ ok: true, message: runRaw() as unknown as ToHelperMessage });
    expect(plain.ok && "preview" in plain.message).toBe(false);
  }));

  it.each([["a string", "true"], ["a number", 1], ["null-like object", {}]])("3.2a refuses a runCell whose preview is %s", (_name, preview) => spec32(() => {
    expect(parseHelperMessage(runRaw({ preview: true }), "toHelper")).toEqual({ ok: true, message: runRaw({ preview: true }) as unknown as ToHelperMessage });
    expect(rejection(runRaw({ preview }), "toHelper")).toBe("invalid-field");
  }));

  it("3.2a accepts a cellResult with a string plot and keeps it", () => spec32(() => {
    const message = resultRaw({ plot: PLOT }) as unknown as ToPageMessage;
    expect(parseHelperMessage(JSON.parse(JSON.stringify(message)), "toPage")).toEqual({ ok: true, message });
  }));

  it("3.2a accepts a cellResult without plot and adds none", () => spec32(() => {
    expect(parseHelperMessage(resultRaw({ plot: PLOT }), "toPage")).toEqual({ ok: true, message: resultRaw({ plot: PLOT }) as unknown as ToPageMessage });
    const plain = parseHelperMessage(resultRaw(), "toPage");
    expect(plain).toEqual({ ok: true, message: resultRaw() as unknown as ToPageMessage });
    expect(plain.ok && "plot" in plain.message).toBe(false);
  }));

  it.each([["a number", 7], ["an object", { format: "labshelf-plot" }], ["a boolean", true]])("3.2a refuses a cellResult whose plot is %s", (_name, plot) => spec32(() => {
    expect(parseHelperMessage(resultRaw({ plot: PLOT }), "toPage")).toEqual({ ok: true, message: resultRaw({ plot: PLOT }) as unknown as ToPageMessage });
    expect(rejection(resultRaw({ plot }), "toPage")).toBe("invalid-field");
  }));
});

describe("3.2b helper host runCell", () => {
  it("3.2b passes preview true to the runner request and omits preview for a normal run", async () => spec32(async () => {
    const h = setup();
    h.handle(runRaw({ id: "p-1", preview: true }));
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.request).toEqual({ code: "1+1", language: "python", noteKey: "paper:p1", preview: true });
    expect(h.calls[0]).toMatchObject({ cwd: CWD, timeoutMs: 60_000 });
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();

    h.handle(runRaw({ id: "p-2" }));
    await until(() => h.calls.length === 2);
    expect(h.calls[1]!.request).not.toHaveProperty("preview");
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();
  }));

  it("3.2b omits preview from the runner request when the message says preview false", async () => spec32(async () => {
    const h = setup();
    h.handle(runRaw({ id: "p-1", preview: true }));
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.request.preview).toBe(true);
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();

    h.handle(runRaw({ id: "p-2", preview: false }));
    await until(() => h.calls.length === 2);
    expect(h.calls[1]!.request).not.toHaveProperty("preview");
    h.finish({ status: "ok", language: "python", durationMs: 1 });
    await h.drain();
  }));

  it("3.2b answers cellResult with the runner's plot and leaves plot out when the runner gave none", async () => spec32(async () => {
    const h = setup();
    h.handle(runRaw({ id: "r-1" }));
    await until(() => h.calls.length === 1);
    h.finish({ status: "ok", language: "python", text: "ok", plot: PLOT, durationMs: 9 });
    await h.drain();
    expect(h.sent).toEqual([{ v: PROTOCOL_VERSION, id: "r-1", type: "cellResult", status: "ok", language: "python", text: "ok", plot: PLOT, durationMs: 9 }]);

    h.sent.length = 0;
    h.handle(runRaw({ id: "r-2" }));
    await until(() => h.calls.length === 2);
    h.finish({ status: "ok", language: "python", text: "ok", durationMs: 9 });
    await h.drain();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: "cellResult", id: "r-2", text: "ok" });
    expect(h.sent[0]).not.toHaveProperty("plot");
  }));
});

describe("3.2c native helper client runCell", () => {
  it("3.2c resolves to a CellResult carrying the plot of the cellResult and sends preview in its runCell", async () => spec32(async () => {
    const { fake, helper } = await connected();
    const pending = helper.runCell({ code: "plot", cwd: "paper:p1", timeoutMs: 1000, language: "python", noteKey: "paper:p1", preview: true } as never, new AbortController().signal);
    await until(() => fake.receivedOfType("runCell").length === 1);
    const sentRun = fake.receivedOfType("runCell")[0]!;
    expect(sentRun.preview).toBe(true);
    fake.sockets[0]!.deliver({ id: sentRun.id, type: "cellResult", status: "ok", language: "python", text: "2", plot: PLOT, durationMs: 5 });
    expect(await pending).toEqual({ status: "ok", language: "python", text: "2", plot: PLOT, durationMs: 5 });
  }));

  it("3.2c resolves without a plot key and sends no preview when the request has none", async () => spec32(async () => {
    const { fake, helper } = await connected();
    const first = helper.runCell({ code: "plot", cwd: "paper:p1", timeoutMs: 1000, language: "python", noteKey: "paper:p1" } as never, new AbortController().signal);
    await until(() => fake.receivedOfType("runCell").length === 1);
    fake.sockets[0]!.deliver({ id: fake.receivedOfType("runCell")[0]!.id, type: "cellResult", status: "ok", language: "python", text: "2", plot: PLOT, durationMs: 5 });
    expect(await first).toHaveProperty("plot", PLOT);
    expect(fake.receivedOfType("runCell")[0]).not.toHaveProperty("preview");

    const second = helper.runCell({ code: "1+1", cwd: "paper:p1", timeoutMs: 1000, language: "python", noteKey: "paper:p1" } as never, new AbortController().signal);
    await until(() => fake.receivedOfType("runCell").length === 2);
    fake.sockets[0]!.deliver({ id: fake.receivedOfType("runCell")[1]!.id, type: "cellResult", status: "ok", language: "python", text: "2", durationMs: 5 });
    expect(fake.receivedOfType("runCell")[1]).not.toHaveProperty("preview");
    const result = await second;
    expect(result).toEqual({ status: "ok", language: "python", text: "2", durationMs: 5 });
    expect(result).not.toHaveProperty("plot");
  }));
});
