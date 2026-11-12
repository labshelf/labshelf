// Pins the helper host: the version-rejection hook runs once and is awaited, and --install-python reports its outcome.
// Also pins the helper's print handlers: printPdf prints the payload HTML through the injected printer and answers pdfPrinted or printFailed, cancelPrint aborts the run by request id, and the hello ready announces printPdf.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { MAX_PRINT_HTML_BYTES, MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage } from "../../../src/helper/index.js";
import { answerHello, createHelperAnswerer, type HelperHandler } from "../../../src/helper/node/helperHandlers.js";
import type { HelperLogger } from "../../../src/helper/node/helperPrivacy.js";
import { createPrintHandlers, runHelperHost, runInstallPython, type PrintHandlerDeps } from "../../../src/helper/node/runHelperHost.js";
import { encodeFrame } from "./helperConnectionHarness.js";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}), redact: jest.fn() } as unknown as HelperLogger;
const DECK_HTML = "<!doctype html><html><head><style>@page { size: 1920px 1080px; }</style></head><body><section>Slide é</section></body></html>";
const PDF = Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55);
const encode = (text: string) => new TextEncoder().encode(text);

const printMessage = (id: string, size = "1920x1080px") => ({ v: PROTOCOL_VERSION, id, type: "printPdf", size }) as unknown as ToHelperMessage;
const cancelMessage = (id: string, requestId: string) => ({ v: PROTOCOL_VERSION, id, type: "cancelPrint", requestId }) as unknown as ToHelperMessage;

type PrintResult = Awaited<ReturnType<PrintHandlerDeps["print"]>>;
interface PrintCall { html: string; size: unknown; signal: AbortSignal }

/** A printer that answers `result`, or, when `hold` is set, waits until its signal aborts and then rejects as Chromium being killed does. */
function fakePrinter(result: PrintResult = PDF, hold = false) {
  const calls: PrintCall[] = [];
  const print = jest.fn((html: string, size: unknown, signal: AbortSignal): Promise<PrintResult> => {
    calls.push({ html, size, signal });
    if (!hold) { return Promise.resolve(result); }
    return new Promise<PrintResult>((_resolve, reject) => {
      const onAbort = () => reject(new Error("Chromium was killed"));
      if (signal.aborted) { onAbort(); } else { signal.addEventListener("abort", onAbort, { once: true }); }
    });
  });
  return { print, calls };
}

interface Sent { message: Record<string, unknown>; payload: Uint8Array | undefined }

function collectSent() {
  const sent: Sent[] = [];
  const send = (message: ToPageMessage, payload?: Uint8Array) => { sent.push({ message: message as unknown as Record<string, unknown>, payload }); };
  return { sent, send };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

beforeEach(() => { jest.clearAllMocks(); });

describe("9.2c printPdf handler", () => {
  it("9.2c prints the payload HTML with the parsed size and answers pdfPrinted with the PDF as payload", async () => {
    const printer = fakePrinter(PDF);
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    await handlers.printPdf(printMessage("p1"), send, encode(DECK_HTML));
    expect(printer.calls).toHaveLength(1);
    expect(printer.calls[0]!.html).toBe(DECK_HTML);
    expect(printer.calls[0]!.size).toEqual({ w: 1920, h: 1080, unit: "px" });
    expect(printer.calls[0]!.signal.aborted).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message).toEqual({ v: PROTOCOL_VERSION, id: "p1", type: "pdfPrinted", bytes: PDF.length });
    expect(Array.from(sent[0]!.payload ?? [])).toEqual(Array.from(PDF));
  });

  it("9.2c passes a physical poster size through parseDeckSize", async () => {
    const printer = fakePrinter(PDF);
    const handlers = createPrintHandlers({ print: printer.print });
    const { send } = collectSent();
    await handlers.printPdf(printMessage("p2", "841x1189mm"), send, encode(DECK_HTML));
    expect(printer.calls[0]!.size).toEqual({ w: 841, h: 1189, unit: "mm" });
  });

  it("9.2c answers printFailed noChromium with the printer's message when no Chromium is found", async () => {
    const printer = fakePrinter({ error: "noChromium", message: "No Chromium-based browser was found." });
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    await handlers.printPdf(printMessage("p3"), send, encode(DECK_HTML));
    expect(sent.map((s) => s.message)).toEqual([{ v: PROTOCOL_VERSION, id: "p3", type: "printFailed", reason: "noChromium", message: "No Chromium-based browser was found." }]);
  });

  it("9.2c answers printFailed failed with the printer's message when printing fails", async () => {
    const printer = fakePrinter({ error: "failed", message: "Chromium exited with code 1." });
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    await handlers.printPdf(printMessage("p4"), send, encode(DECK_HTML));
    expect(sent.map((s) => s.message)).toEqual([{ v: PROTOCOL_VERSION, id: "p4", type: "printFailed", reason: "failed", message: "Chromium exited with code 1." }]);
  });

  it("9.2c refuses HTML over MAX_PRINT_HTML_BYTES with printFailed limit without printing", async () => {
    const printer = fakePrinter(PDF);
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    await handlers.printPdf(printMessage("p5"), send, new Uint8Array(MAX_PRINT_HTML_BYTES + 1).fill(97));
    expect(printer.print).not.toHaveBeenCalled();
    expect(sent.map((s) => s.message)).toEqual([expect.objectContaining({ v: PROTOCOL_VERSION, id: "p5", type: "printFailed", reason: "limit", message: expect.any(String) })]);
  });

  it("9.2c answers a PDF larger than the socket message limit with printFailed limit", async () => {
    const printer = fakePrinter(new Uint8Array(MAX_SOCKET_MESSAGE_BYTES + 1));
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    await handlers.printPdf(printMessage("p6"), send, encode(DECK_HTML));
    expect(sent.map((s) => s.message)).toEqual([expect.objectContaining({ id: "p6", type: "printFailed", reason: "limit" })]);
    expect(sent.some((s) => s.message.type === "pdfPrinted")).toBe(false);
  });

  it("9.2c answers printFailed failed without printing when the size is not a deck size", async () => {
    const printer = fakePrinter(PDF);
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    await handlers.printPdf(printMessage("p7", "big"), send, encode(DECK_HTML));
    expect(printer.print).not.toHaveBeenCalled();
    expect(sent.map((s) => s.message)).toEqual([expect.objectContaining({ id: "p7", type: "printFailed", reason: "failed" })]);
  });
});

describe("9.2c cancelPrint", () => {
  it("9.2c a cancelPrint naming the request aborts the run and the run answers printFailed failed Cancelled.", async () => {
    const printer = fakePrinter(PDF, true);
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    const run = handlers.printPdf(printMessage("p8"), send, encode(DECK_HTML));
    await until(() => printer.calls.length === 1);
    await handlers.cancelPrint(cancelMessage("c8", "p8"), send);
    await run;
    expect(printer.calls[0]!.signal.aborted).toBe(true);
    expect(sent.map((s) => s.message)).toEqual([{ v: PROTOCOL_VERSION, id: "p8", type: "printFailed", reason: "failed", message: "Cancelled." }]);
  });

  it("9.2c ignores a cancelPrint whose requestId names no run", async () => {
    const printer = fakePrinter(PDF, true);
    const handlers = createPrintHandlers({ print: printer.print });
    const { sent, send } = collectSent();
    void handlers.printPdf(printMessage("p9"), send, encode(DECK_HTML));
    await until(() => printer.calls.length === 1);
    await expect(handlers.cancelPrint(cancelMessage("c9", "nope"), send)).resolves.toBeUndefined();
    expect(printer.calls[0]!.signal.aborted).toBe(false);
    expect(sent).toEqual([]);
    await handlers.cancelPrint(cancelMessage("c9b", "p9"), send);
  });

  it("9.2c the dispatcher runs cancelPrint ahead of the queue, so it reaches a print in flight", async () => {
    const printer = fakePrinter(PDF, true);
    const handlers = createPrintHandlers({ print: printer.print });
    const dispatcher = createHelperAnswerer({ printPdf: handlers.printPdf as HelperHandler, cancelPrint: handlers.cancelPrint as HelperHandler }, logger);
    const sent: Array<Record<string, unknown>> = [];
    const send = (message: Record<string, unknown>) => { sent.push(message); };
    const handle = (envelope: Record<string, unknown>, payload: Uint8Array) => dispatcher.handle(envelope as never, payload, send as never);
    handle({ v: PROTOCOL_VERSION, id: "p10", type: "printPdf", size: "1920x1080px" }, encode(DECK_HTML));
    await until(() => printer.calls.length === 1);
    handle({ v: PROTOCOL_VERSION, id: "c10", type: "cancelPrint", requestId: "p10" }, new Uint8Array());
    await dispatcher.drain();
    expect(printer.calls[0]!.signal.aborted).toBe(true);
    expect(sent).toContainEqual({ v: PROTOCOL_VERSION, id: "p10", type: "printFailed", reason: "failed", message: "Cancelled." });
  });
});

describe("9.2d the hello ready", () => {
  it("9.2d answerHello's ready announces the printPdf capability", async () => {
    const { sent, send } = collectSent();
    const dispatcher = createHelperAnswerer({}, logger);
    const socket = await answerHello(
      { v: PROTOCOL_VERSION, id: "1", type: "hello", extensionVersion: "0.2.0", origin: "chrome-extension://abcdefghijklmnop" },
      send,
      { helperVersion: "0.1.0", host: "helper", texStatus: async () => ({ source: "none", complete: false }), logger, handle: dispatcher.handle },
    );
    try {
      const ready = sent.find((s) => s.message.type === "ready")?.message;
      expect(ready).toMatchObject({ v: PROTOCOL_VERSION, id: "1", type: "ready", protocol: PROTOCOL_VERSION, capabilities: ["printPdf", "ocr", "linkedOutputs"] });
    } finally {
      await socket?.close();
    }
  });
});

describe("runHelperHost", () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), "labshelf-host-")); });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it("waits for afterVersionRejected after a hello of another protocol version", async () => {
    const input = new PassThrough();
    const events: string[] = [];
    const done = runHelperHost({
      dataDir, logger, helperVersion: "0.2.0", host: "helper", args: [], typstWasm: async () => new Uint8Array(), input,
      output: new PassThrough(),
      afterVersionRejected: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); events.push("update checked"); },
    }).then(() => events.push("host exited"));
    input.write(encodeFrame({ v: PROTOCOL_VERSION + 1, id: "1", type: "hello", extensionVersion: "9", origin: "chrome-extension://abc" }));
    input.end();
    await done;
    expect(events).toEqual(["update checked", "host exited"]);
  });
});

type Provider = Parameters<typeof runInstallPython>[0];
type Status = Awaited<ReturnType<Provider["install"]>>;

const INSTALLED = { state: "installed", version: "3.12.4", sympy: "1.13.0" } as Status;
const MISSING = { state: "missing" } as Status;

function fakeProvider(install: Provider["install"]): { provider: Provider; install: jest.Mock } {
  const fn = jest.fn(install);
  const provider = { status: async () => MISSING, install: fn } as unknown as Provider;
  return { provider, install: fn };
}

function collect(): { lines: string[]; write: (message: string) => void } {
  const lines: string[] = [];
  return { lines, write: (message) => void lines.push(message) };
}

describe("runInstallPython", () => {
  it("11.7a returns 0 after a successful install", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { write } = collect();
    expect(await runInstallPython(provider, write)).toBe(0);
  });

  it("11.7a calls install exactly once", async () => {
    const { provider, install } = fakeProvider(async () => INSTALLED);
    await runInstallPython(provider, collect().write);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("11.7a names the installed Python version on success", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.includes("3.12.4"))).toBe(true);
  });

  it("11.7a does not write a failure line on success", async () => {
    const { provider } = fakeProvider(async () => INSTALLED);
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.startsWith("Python install failed:"))).toBe(false);
  });

  it("11.7a passes progress messages from install to write", async () => {
    const { provider } = fakeProvider(async (onProgress) => {
      onProgress?.("Downloading Python", 0.25);
      return INSTALLED;
    });
    const { lines, write } = collect();
    await runInstallPython(provider, write);
    expect(lines.some((line) => line.includes("Downloading Python"))).toBe(true);
  });

  it("11.7a returns 1 and writes a failure line when install throws", async () => {
    const { provider } = fakeProvider(async () => {
      throw new Error("network down");
    });
    const { lines, write } = collect();
    expect(await runInstallPython(provider, write)).toBe(1);
    const failure = lines.filter((line) => line.startsWith("Python install failed:"));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain("network down");
  });

  it("11.7a returns 1 and writes a failure line when install resolves missing", async () => {
    const { provider } = fakeProvider(async () => MISSING);
    const { lines, write } = collect();
    expect(await runInstallPython(provider, write)).toBe(1);
    expect(lines.filter((line) => line.startsWith("Python install failed:"))).toHaveLength(1);
  });

  it("11.7a does not throw when install throws a non-Error value", async () => {
    const { provider } = fakeProvider(async () => {
      throw "boom";
    });
    const { lines, write } = collect();
    await expect(runInstallPython(provider, write)).resolves.toBe(1);
    expect(lines.some((line) => line.startsWith("Python install failed:") && line.includes("boom"))).toBe(true);
  });

  it("11.7a calls install once even when it fails", async () => {
    const { provider, install } = fakeProvider(async () => {
      throw new Error("x");
    });
    await runInstallPython(provider, collect().write);
    expect(install).toHaveBeenCalledTimes(1);
  });
});
