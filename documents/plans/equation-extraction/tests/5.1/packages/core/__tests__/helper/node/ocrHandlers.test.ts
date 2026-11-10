// Pins the helper's OCR messages: their constants and parsers, the ocr, cancelOcr and installPix2tex handlers over a fake pix2tex runner and provider,
// the capability the hello ready announces, the dispatcher running cancelOcr ahead of the queue, and the client's ocr and installPix2tex over a fake helper.
import type { ILogger } from "../../../src/ports/index.js";
import { PROTOCOL_VERSION, MAX_OCR_PNG_BYTES, OCR_CAPABILITY, OCR_FAILURES, type ToHelperMessage, type ToPageMessage } from "../../../src/helper/helperMessages.js";
import { parseHelperMessage } from "../../../src/helper/parseHelperMessage.js";
import { helperCanOcr, type HelperState } from "../../../src/helper/helperPaths.js";
import { createNativeLatexHelper } from "../../../src/helper/helperClient.js";
import { HELPER_CAPABILITIES, answerHello, createHelperAnswerer, type HelperHandler } from "../../../src/helper/node/helperHandlers.js";
import type { HelperLogger } from "../../../src/helper/node/helperPrivacy.js";
import { createOcrHandlers, type OcrHandlerDeps } from "../../../src/helper/node/ocrHandlers.js";
import type { Pix2texRunner } from "../../../src/equations/node/pix2texRunner.js";
import type { Pix2texProvider } from "../../../src/equations/node/installPix2tex.js";
import { FakeHelper, fakeLogger, type FakeSocket } from "../fakeHelperClient.js";

const ENV = (id: string) => ({ v: PROTOCOL_VERSION, id });
const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const TEX = { source: "texlive", year: 2026, complete: true } as const;

const parsed = (raw: unknown, direction: "toHelper" | "toPage") => parseHelperMessage(raw, direction);
const rejection = (raw: unknown, direction: "toHelper" | "toPage") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

describe("A9 the OCR message constants", () => {
  it("A9 keeps the protocol version at 11, as helper#version says features are capabilities", () => {
    expect(PROTOCOL_VERSION).toBe(11);
  });

  it("A9 names the capability ocr", () => {
    expect(OCR_CAPABILITY).toBe("ocr");
  });

  it("A9 lists the OCR failures missing, limit and failed", () => {
    expect([...OCR_FAILURES]).toEqual(["missing", "limit", "failed"]);
  });

  it("A9 sets MAX_OCR_PNG_BYTES to 4 MiB", () => {
    expect(MAX_OCR_PNG_BYTES).toBe(4 * 1024 * 1024);
  });

  it("A9 announces ocr next to printPdf in HELPER_CAPABILITIES", () => {
    expect(HELPER_CAPABILITIES).toContain("ocr");
    expect(HELPER_CAPABILITIES).toContain("printPdf");
  });
});

describe("A9 OCR messages at the parser", () => {
  it("A9 accepts an ocr with its byte count sent to the helper", () => {
    const message = { ...ENV("o1"), type: "ocr", bytes: 8 };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("A9 rejects an ocr whose bytes is not a non-negative integer", () => {
    expect(rejection({ ...ENV("o1"), type: "ocr" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: "8" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: -1 }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: 1.5 }, "toHelper")).toBe("invalid-field");
  });

  it("A9 rejects an ocr sent to the page as unknown-type", () => {
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: 8 }, "toPage")).toBe("unknown-type");
  });

  it("A9 accepts a cancelOcr naming a request id", () => {
    const message = { ...ENV("c1"), type: "cancelOcr", requestId: "o1" };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("A9 rejects a cancelOcr without a string requestId", () => {
    expect(rejection({ ...ENV("c1"), type: "cancelOcr" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("c1"), type: "cancelOcr", requestId: 7 }, "toHelper")).toBe("invalid-field");
  });

  it("A9 rejects a cancelOcr sent to the page as unknown-type", () => {
    expect(rejection({ ...ENV("c1"), type: "cancelOcr", requestId: "o1" }, "toPage")).toBe("unknown-type");
  });

  it("A9 accepts an installPix2tex sent to the helper", () => {
    const message = { ...ENV("i1"), type: "installPix2tex" };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("A9 rejects an installPix2tex sent to the page as unknown-type", () => {
    expect(rejection({ ...ENV("i1"), type: "installPix2tex" }, "toPage")).toBe("unknown-type");
  });

  it("A9 accepts an ocrResult with its latex sent to the page", () => {
    const message = { ...ENV("o1"), type: "ocrResult", latex: "x^{2}+1" };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("A9 rejects an ocrResult without a string latex", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrResult" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocrResult", latex: 3 }, "toPage")).toBe("invalid-field");
  });

  it("A9 rejects an ocrResult sent to the helper as unknown-type", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrResult", latex: "x" }, "toHelper")).toBe("unknown-type");
  });

  it.each(["missing", "limit", "failed"])("A9 accepts an ocrFailed with reason %s", (reason) => {
    const message = { ...ENV("o1"), type: "ocrFailed", reason, message: "No pix2tex." };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("A9 rejects an ocrFailed with a reason outside missing, limit and failed", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "unsupported", message: "x" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "cancelled", message: "x" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", message: "x" }, "toPage")).toBe("invalid-field");
  });

  it("A9 rejects an ocrFailed without a string message", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "failed" }, "toPage")).toBe("invalid-field");
  });

  it("A9 rejects an ocrFailed sent to the helper as unknown-type", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "failed", message: "x" }, "toHelper")).toBe("unknown-type");
  });

  it("A9 keeps ocr in a ready's capabilities", () => {
    const message = {
      ...ENV("r1"), type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper", tex: TEX, capabilities: ["printPdf", "ocr"],
    };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });
});

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

// The client over a fake helper that also answers the OCR messages.

type Envelope = Record<string, any>;

/** A FakeHelper that answers `ocr` and `installPix2tex` as a helper with the capability does. */
class OcrFakeHelper extends FakeHelper {
  /** How `ocr` is answered: `ocrResult` with `latex`, `ocrFailed` with `reason` and `message`, or not at all. */
  ocrReply: { latex: string } | { reason: string; message: string } | "mute" = { latex: "x^{2}" };

  override answer(socket: FakeSocket, m: Envelope, payload: Uint8Array = new Uint8Array(0)): void {
    super.answer(socket, m, payload);
    const reply = (body: Envelope) => socket.deliver({ id: m.id, ...body });
    queueMicrotask(() => {
      if (m.type === "ocr") {
        const script = this.ocrReply;
        if (script === "mute") { return; }
        reply("latex" in script ? { type: "ocrResult", latex: script.latex } : { type: "ocrFailed", reason: script.reason, message: script.message });
      } else if (m.type === "installPix2tex") {
        reply({ type: "progress", phase: "python", message: "Installing pix2tex", fraction: 0.5 });
        reply({ type: "ready", host: "helper", protocol: this.protocol, helperVersion: "1.0.0", tex: this.tex, capabilities: ["printPdf", "ocr"] });
      }
    });
  }
}

function clientSetup(...args: [capabilities?: unknown[] | undefined]) {
  const fake = new OcrFakeHelper();
  // No argument: a helper announcing ocr. An explicit undefined: an older helper whose ready omits capabilities.
  fake.capabilities = args.length === 0 ? ["printPdf", "ocr"] : args[0];
  const helper = createNativeLatexHelper({
    logger: fakeLogger(), extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket,
  });
  return { fake, helper };
}

const sentOnSocket = (fake: FakeHelper, type: string) => fake.sockets.flatMap((s) => s.sent).filter((s) => s.message.type === type);

describe("5.1a ocr on the client", () => {
  it("5.1a sends ocr with the byte count over the socket and the PNG as the payload", async () => {
    const { fake, helper } = clientSetup();
    await helper.connect();
    await helper.ocr(PNG, new AbortController().signal);
    const sent = sentOnSocket(fake, "ocr");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message).toMatchObject({ type: "ocr", bytes: PNG.length });
    expect(Array.from(sent[0]!.payload)).toEqual(Array.from(PNG));
    expect(fake.nativePosted.map((m) => m.type)).toEqual(["hello"]);
  });

  it("5.1a resolves the LaTeX from the ocrResult", async () => {
    const { fake, helper } = clientSetup();
    fake.ocrReply = { latex: "\\int_0^1 f" };
    await helper.connect();
    expect(await helper.ocr(PNG, new AbortController().signal)).toEqual({ ok: true, latex: "\\int_0^1 f" });
  });

  it.each([
    ["missing", "pix2tex is not installed."],
    ["limit", "The image is too large."],
    ["failed", "The worker crashed."],
  ] as const)("5.1a resolves an ocrFailed %s as that failure", async (reason, message) => {
    const { fake, helper } = clientSetup();
    fake.ocrReply = { reason, message };
    await helper.connect();
    expect(await helper.ocr(PNG, new AbortController().signal)).toEqual({ ok: false, reason, message });
  });

  it("5.1a on abort sends cancelOcr for the request and resolves cancelled without waiting for a reply", async () => {
    const { fake, helper } = clientSetup();
    fake.ocrReply = "mute";
    await helper.connect();
    const controller = new AbortController();
    const pending = helper.ocr(PNG, controller.signal);
    await flush();
    const request = fake.receivedOfType("ocr")[0]!;
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    await flush();
    expect(fake.receivedOfType("cancelOcr")).toEqual([expect.objectContaining({ type: "cancelOcr", requestId: request.id })]);
  });

  it("5.1a resolves cancelled without sending when the signal is already aborted", async () => {
    const { fake, helper } = clientSetup();
    await helper.connect();
    const controller = new AbortController();
    controller.abort();
    expect(await helper.ocr(PNG, controller.signal)).toMatchObject({ ok: false, reason: "cancelled" });
    expect(fake.receivedOfType("ocr")).toHaveLength(0);
  });
});

describe("5.1b the client's capability refusal and install", () => {
  const unsupported = { ok: false, reason: "unsupported", message: "Update LabShelf Helper to read equations." };

  it("5.1b resolves unsupported without sending when the helper's ready has no capabilities", async () => {
    const { fake, helper } = clientSetup(undefined);
    await helper.connect();
    expect(await helper.ocr(PNG, new AbortController().signal)).toEqual(unsupported);
    expect(fake.receivedOfType("ocr")).toHaveLength(0);
  });

  it("5.1b resolves unsupported when the helper announces printPdf but not ocr", async () => {
    const { fake, helper } = clientSetup(["printPdf"]);
    await helper.connect();
    expect(await helper.ocr(PNG, new AbortController().signal)).toEqual(unsupported);
    expect(fake.receivedOfType("ocr")).toHaveLength(0);
  });

  it("5.1b installPix2tex sends the message, forwards progress in the python phase and resolves on ready", async () => {
    const { fake, helper } = clientSetup();
    await helper.connect();
    const progress: unknown[] = [];
    await helper.installPix2tex((p) => progress.push(p));
    expect(fake.receivedOfType("installPix2tex")).toHaveLength(1);
    expect(progress).toEqual([{ phase: "python", message: "Installing pix2tex", fraction: 0.5 }]);
  });

  it("5.1b the client status keeps ocr after an install whose ready announces it", async () => {
    const { helper } = clientSetup(["printPdf"]);
    await helper.connect();
    expect(helperCanOcr(helper.status())).toBe(false);
    await helper.installPix2tex(() => undefined);
    expect(helperCanOcr(helper.status())).toBe(true);
  });
});

describe("5.1b helperCanOcr", () => {
  const ready: Extract<HelperState, { state: "ready" }> = { state: "ready", helperVersion: "1.0.0", tex: { source: "tinytex", year: 2025, complete: true }, host: "helper" };

  it("5.1b is false without a state", () => {
    expect(helperCanOcr(undefined)).toBe(false);
  });

  it("5.1b is false for states that are not ready", () => {
    expect(helperCanOcr({ state: "not-installed" })).toBe(false);
    expect(helperCanOcr({ state: "update-helper", protocol: 10, host: "helper" })).toBe(false);
    expect(helperCanOcr({ state: "update-extension", protocol: 12 })).toBe(false);
  });

  it("5.1b is false for a ready state without ocr", () => {
    expect(helperCanOcr(ready)).toBe(false);
    expect(helperCanOcr({ ...ready, capabilities: [] })).toBe(false);
    expect(helperCanOcr({ ...ready, capabilities: ["printPdf"] })).toBe(false);
  });

  it("5.1b is true for a ready state announcing ocr", () => {
    expect(helperCanOcr({ ...ready, capabilities: ["printPdf", "ocr"] })).toBe(true);
  });
});
