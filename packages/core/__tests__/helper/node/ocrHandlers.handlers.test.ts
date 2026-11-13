// Pins the ocr, cancelOcr and installPix2tex handlers over a fake pix2tex runner and provider, the capability the hello ready announces, and the dispatcher running cancelOcr ahead of the queue.
import { PROTOCOL_VERSION, MAX_OCR_PNG_BYTES, type ToHelperMessage, type ToPageMessage } from "../../../src/helper/helperMessages.js";
import { HELPER_CAPABILITIES, answerHello, createHelperAnswerer } from "../../../src/helper/node/helperHandlers.js";
import type { HelperLogger } from "../../../src/helper/node/helperPrivacy.js";
import { createOcrHandlers, type OcrHandlerDeps } from "../../../src/helper/node/ocrHandlers.js";
import type { Pix2texRunner } from "../../../src/equations/node/pix2texRunner.js";
import { ENV, PNG, TEX } from "./ocrHandlersHarness.js";

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

// The ocr, cancelOcr and installPix2tex handlers.

const errors: unknown[] = [];
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async (_module: string, error: unknown) => { errors.push(error); }), redact: jest.fn() } as unknown as ILogger & HelperLogger;

interface ReadCall { png: Uint8Array; signal: AbortSignal | undefined }
type Found = Awaited<ReturnType<Pix2texRunner["find"]>>;
const FOUND: Found = { python: "/py/bin/python3", origin: "managed" };

/** A runner that finds `found` and reads `latex`; with `hold` set, read waits until its signal aborts and then rejects as a killed worker does. */
function fakeRunner(options: { found?: Found; latex?: string; failure?: Error; hold?: boolean } = {}) {
  const calls: ReadCall[] = [];
  const found = "found" in options ? options.found : FOUND;
  const find = jest.fn(async () => found);
  const read = jest.fn((png: Uint8Array, signal?: AbortSignal): Promise<string> => {
    calls.push({ png, signal });
    if (options.failure) { return Promise.reject(options.failure); }
    if (!options.hold) { return Promise.resolve(options.latex ?? "x^{2}"); }
    return new Promise<string>((_resolve, reject) => {
      const onAbort = () => reject(new Error("worker killed"));
      if (signal?.aborted) { onAbort(); } else { signal?.addEventListener("abort", onAbort, { once: true }); }
    });
  });
  return { runner: { find, read } as OcrHandlerDeps["runner"], find, read, calls };
}

type Progress = [message: string, fraction?: number];

function fakeProvider(steps: Progress[], failure?: Error) {
  const install = jest.fn(async (onProgress: (message: string, fraction?: number) => void) => {
    for (const [message, fraction] of steps) {
      if (fraction === undefined) { onProgress(message); } else { onProgress(message, fraction); }
    }
    if (failure) { throw failure; }
  });
  return { provider: { install } as OcrHandlerDeps["provider"], install };
}

const READY_FIELDS = { helperVersion: "1.2.3", host: "helper", tex: TEX, python: "installed" } as const;

function setup(runner: OcrHandlerDeps["runner"], provider: OcrHandlerDeps["provider"] = fakeProvider([]).provider) {
  const handlers = createOcrHandlers({ runner, provider, readyFields: async () => ({ ...READY_FIELDS }), logger });
  const sent: Array<{ message: Record<string, unknown>; payload: Uint8Array | undefined }> = [];
  const send = (message: ToPageMessage, payload?: Uint8Array) => { sent.push({ message: message as unknown as Record<string, unknown>, payload }); };
  return { handlers, sent, send, replies: () => sent.map((s) => s.message) };
}

const ocrMessage = (id: string, bytes = PNG.length) => ({ ...ENV(id), type: "ocr", bytes }) as unknown as ToHelperMessage;
const cancelMessage = (id: string, requestId: string) => ({ ...ENV(id), type: "cancelOcr", requestId }) as unknown as ToHelperMessage;
const installMessage = (id: string) => ({ ...ENV(id), type: "installPix2tex" }) as unknown as ToHelperMessage;

beforeEach(() => { errors.length = 0; jest.clearAllMocks(); });

describe("5.1a ocr handler", () => {
  it("5.1a reads the payload PNG through the runner and answers ocrResult with its LaTeX", async () => {
    const { runner, calls } = fakeRunner({ latex: "\\frac{a}{b}" });
    const { handlers, send, replies } = setup(runner);
    await handlers.ocr(ocrMessage("o1"), send, PNG);
    expect(calls).toHaveLength(1);
    expect(Array.from(calls[0]!.png)).toEqual(Array.from(PNG));
    expect(replies()).toEqual([{ v: PROTOCOL_VERSION, id: "o1", type: "ocrResult", latex: "\\frac{a}{b}" }]);
  });

  it("5.1a gives the runner a signal that is not aborted for a normal read", async () => {
    const { runner, calls } = fakeRunner();
    const { handlers, send } = setup(runner);
    await handlers.ocr(ocrMessage("o2"), send, PNG);
    expect(calls[0]!.signal?.aborted ?? false).toBe(false);
  });

  it("5.1a answers ocrFailed missing without reading when the runner finds no pix2tex", async () => {
    const { runner, read } = fakeRunner({ found: undefined });
    const { handlers, send, replies } = setup(runner);
    await handlers.ocr(ocrMessage("o3"), send, PNG);
    expect(read).not.toHaveBeenCalled();
    expect(replies()).toEqual([expect.objectContaining({ v: PROTOCOL_VERSION, id: "o3", type: "ocrFailed", reason: "missing", message: expect.any(String) })]);
  });

  it("5.1a answers ocrFailed failed with the error text when the read rejects", async () => {
    const { runner } = fakeRunner({ failure: new Error("model exploded") });
    const { handlers, send, replies } = setup(runner);
    await handlers.ocr(ocrMessage("o4"), send, PNG);
    expect(replies()).toHaveLength(1);
    expect(replies()[0]).toMatchObject({ v: PROTOCOL_VERSION, id: "o4", type: "ocrFailed", reason: "failed" });
    expect(String(replies()[0]!.message)).toContain("model exploded");
  });

  it("5.1a refuses a PNG over MAX_OCR_PNG_BYTES with ocrFailed limit without calling the runner", async () => {
    const { runner, find, read } = fakeRunner();
    const { handlers, send, replies } = setup(runner);
    await handlers.ocr(ocrMessage("o5", MAX_OCR_PNG_BYTES + 1), send, new Uint8Array(MAX_OCR_PNG_BYTES + 1));
    expect(find).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(replies()).toEqual([expect.objectContaining({ v: PROTOCOL_VERSION, id: "o5", type: "ocrFailed", reason: "limit", message: expect.any(String) })]);
  });

  it("5.1a reads a PNG of exactly MAX_OCR_PNG_BYTES", async () => {
    const { runner, read } = fakeRunner({ latex: "y" });
    const { handlers, send, replies } = setup(runner);
    await handlers.ocr(ocrMessage("o6", MAX_OCR_PNG_BYTES), send, new Uint8Array(MAX_OCR_PNG_BYTES));
    expect(read).toHaveBeenCalledTimes(1);
    expect(replies()).toEqual([{ v: PROTOCOL_VERSION, id: "o6", type: "ocrResult", latex: "y" }]);
  });

  it("5.1a rejects a message of another type", async () => {
    const { runner } = fakeRunner();
    const { handlers, send } = setup(runner);
    await expect(handlers.ocr(cancelMessage("x", "o1"), send, PNG)).rejects.toThrow();
  });
});

describe("5.1a cancelOcr", () => {
  it("5.1a a cancelOcr naming the request aborts the read and the run answers ocrFailed failed Cancelled.", async () => {
    const { runner, calls } = fakeRunner({ hold: true });
    const { handlers, send, replies } = setup(runner);
    const run = handlers.ocr(ocrMessage("o7"), send, PNG);
    await until(() => calls.length === 1);
    await handlers.cancelOcr(cancelMessage("c7", "o7"), send);
    await run;
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(replies()).toEqual([{ v: PROTOCOL_VERSION, id: "o7", type: "ocrFailed", reason: "failed", message: "Cancelled." }]);
  });

  it("5.1a sends no reply of its own for the cancelOcr", async () => {
    const { runner, calls } = fakeRunner({ hold: true });
    const { handlers, send, sent } = setup(runner);
    const run = handlers.ocr(ocrMessage("o8"), send, PNG);
    await until(() => calls.length === 1);
    await handlers.cancelOcr(cancelMessage("c8", "o8"), send);
    await run;
    expect(sent.filter((s) => s.message.id === "c8")).toEqual([]);
  });

  it("5.1a a cancelOcr that arrives before the run's first await still cancels it, with exactly one reply", async () => {
    const { runner } = fakeRunner({ hold: true });
    const { handlers, send, replies } = setup(runner);
    const run = handlers.ocr(ocrMessage("o9"), send, PNG);
    const cancel = handlers.cancelOcr(cancelMessage("c9", "o9"), send);
    await Promise.all([run, cancel]);
    expect(replies()).toEqual([{ v: PROTOCOL_VERSION, id: "o9", type: "ocrFailed", reason: "failed", message: "Cancelled." }]);
  });

  it("5.1a ignores a cancelOcr whose requestId names no run", async () => {
    const { runner, calls } = fakeRunner({ hold: true });
    const { handlers, send, sent } = setup(runner);
    const run = handlers.ocr(ocrMessage("o10"), send, PNG);
    await until(() => calls.length === 1);
    await expect(handlers.cancelOcr(cancelMessage("c10", "nope"), send)).resolves.toBeUndefined();
    expect(calls[0]!.signal?.aborted).toBe(false);
    expect(sent).toEqual([]);
    await handlers.cancelOcr(cancelMessage("c10b", "o10"), send);
    await run;
  });

  it("5.1a ignores a cancelOcr for a run that already answered", async () => {
    const { runner } = fakeRunner();
    const { handlers, send, replies } = setup(runner);
    await handlers.ocr(ocrMessage("o11"), send, PNG);
    await expect(handlers.cancelOcr(cancelMessage("c11", "o11"), send)).resolves.toBeUndefined();
    expect(replies()).toHaveLength(1);
  });

  it("5.1a cancels only the named run among two", async () => {
    const { runner, calls } = fakeRunner({ hold: true });
    const { handlers, send, replies } = setup(runner);
    const first = handlers.ocr(ocrMessage("o12"), send, PNG);
    const second = handlers.ocr(ocrMessage("o13"), send, PNG);
    await until(() => calls.length >= 1);
    await handlers.cancelOcr(cancelMessage("c12", "o12"), send);
    await first;
    expect(replies()).toEqual([{ v: PROTOCOL_VERSION, id: "o12", type: "ocrFailed", reason: "failed", message: "Cancelled." }]);
    await handlers.cancelOcr(cancelMessage("c13", "o13"), send);
    await second;
  });

  it("5.1a rejects a cancelOcr handler call with a message of another type", async () => {
    const { runner } = fakeRunner();
    const { handlers, send } = setup(runner);
    await expect(handlers.cancelOcr(ocrMessage("x"), send)).rejects.toThrow();
  });

  it("5.1a the dispatcher runs cancelOcr ahead of the queue, so it reaches an ocr in flight", async () => {
    const { runner, calls } = fakeRunner({ hold: true });
    const { handlers } = setup(runner);
    const dispatcher = createHelperAnswerer({ ocr: handlers.ocr, cancelOcr: handlers.cancelOcr }, logger);
    const sent: Array<Record<string, unknown>> = [];
    const send = (message: Record<string, unknown>) => { sent.push(message); };
    const handle = (envelope: Record<string, unknown>, payload: Uint8Array) => dispatcher.handle(envelope as never, payload, send as never);
    handle({ ...ENV("o14"), type: "ocr", bytes: PNG.length }, PNG);
    await until(() => calls.length === 1);
    handle({ ...ENV("c14"), type: "cancelOcr", requestId: "o14" }, new Uint8Array());
    await dispatcher.drain();
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(sent).toContainEqual({ v: PROTOCOL_VERSION, id: "o14", type: "ocrFailed", reason: "failed", message: "Cancelled." });
  });

  it("5.1a the dispatcher hands an ocr its payload and sends the result back", async () => {
    const { runner, calls } = fakeRunner({ latex: "z" });
    const { handlers } = setup(runner);
    const dispatcher = createHelperAnswerer({ ocr: handlers.ocr, cancelOcr: handlers.cancelOcr }, logger);
    const sent: Array<Record<string, unknown>> = [];
    dispatcher.handle({ ...ENV("o15"), type: "ocr", bytes: PNG.length } as never, PNG, ((m: Record<string, unknown>) => { sent.push(m); }) as never);
    await dispatcher.drain();
    expect(Array.from(calls[0]!.png)).toEqual(Array.from(PNG));
    expect(sent).toEqual([{ v: PROTOCOL_VERSION, id: "o15", type: "ocrResult", latex: "z" }]);
  });
});

describe("5.1b installPix2tex handler", () => {
  it("5.1b sends one python progress per provider callback with the request id", async () => {
    const { provider } = fakeProvider([["download", 0.2], ["venv", 0.6], ["weights", 1]]);
    const { handlers, send, replies } = setup(fakeRunner().runner, provider);
    await handlers.installPix2tex(installMessage("i1"), send);
    const progress = replies().filter((m) => m.type === "progress");
    expect(progress).toHaveLength(3);
    expect(progress.map((m) => m.fraction)).toEqual([0.2, 0.6, 1]);
    for (const message of progress) {
      expect(message).toMatchObject({ v: PROTOCOL_VERSION, id: "i1", type: "progress", phase: "python", message: "Installing pix2tex" });
    }
  });

  it("5.1b leaves fraction out of a progress whose callback gave none", async () => {
    const { provider } = fakeProvider([["starting"]]);
    const { handlers, send, replies } = setup(fakeRunner().runner, provider);
    await handlers.installPix2tex(installMessage("i2"), send);
    const progress = replies().find((m) => m.type === "progress");
    expect(progress).toBeDefined();
    expect(progress).not.toHaveProperty("fraction");
  });

  it("5.1b ends with a ready carrying the ready fields and the helper's capabilities", async () => {
    const { provider, install } = fakeProvider([["download", 0.5]]);
    const { handlers, send, replies } = setup(fakeRunner().runner, provider);
    await handlers.installPix2tex(installMessage("i3"), send);
    expect(install).toHaveBeenCalledTimes(1);
    expect(replies().map((m) => m.type)).toEqual(["progress", "ready"]);
    expect(replies()[1]).toEqual({
      v: PROTOCOL_VERSION, id: "i3", type: "ready", protocol: PROTOCOL_VERSION, ...READY_FIELDS, capabilities: [...HELPER_CAPABILITIES],
    });
  });

  it("5.1b sends only the ready when the provider reports no progress", async () => {
    const { handlers, send, replies } = setup(fakeRunner().runner, fakeProvider([]).provider);
    await handlers.installPix2tex(installMessage("i4"), send);
    expect(replies()).toMatchObject([{ id: "i4", type: "ready" }]);
  });

  it("5.1b answers a failing install with one pix2tex-install-failed error and no ready", async () => {
    const { provider } = fakeProvider([["download", 0.1]], new Error("checksum mismatch"));
    const { handlers, send, replies } = setup(fakeRunner().runner, provider);
    await handlers.installPix2tex(installMessage("i5"), send);
    expect(replies().filter((m) => m.type === "ready")).toHaveLength(0);
    expect(replies().filter((m) => m.type === "error")).toEqual([{ v: PROTOCOL_VERSION, id: "i5", type: "error", code: "pix2tex-install-failed", message: "checksum mismatch" }]);
  });

  it("5.1b logs the install failure through the logger's error", async () => {
    const boom = new Error("disk full");
    const { handlers, send } = setup(fakeRunner().runner, fakeProvider([], boom).provider);
    await handlers.installPix2tex(installMessage("i6"), send);
    expect(errors).toContain(boom);
  });

  it("5.1b rejects a message of another type", async () => {
    const { handlers, send } = setup(fakeRunner().runner);
    await expect(handlers.installPix2tex(ocrMessage("x"), send)).rejects.toThrow();
  });
});

describe("A9 the hello ready", () => {
  it("A9 answerHello's ready announces ocr next to printPdf", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const dispatcher = createHelperAnswerer({}, logger);
    const socket = await answerHello(
      { ...ENV("1"), type: "hello", extensionVersion: "0.2.0", origin: "chrome-extension://abcdefghijklmnop" },
      (m) => { sent.push(m as unknown as Record<string, unknown>); },
      { helperVersion: "0.1.0", host: "helper", texStatus: async () => ({ source: "none", complete: false }), logger, handle: dispatcher.handle },
    );
    try {
      const ready = sent.find((m) => m.type === "ready");
      expect(ready?.capabilities).toEqual(expect.arrayContaining(["printPdf", "ocr"]));
    } finally {
      await socket?.close();
    }
  });
});
