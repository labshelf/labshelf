// Pins the browser equation port's helper-backed pix2tex source, the pix2tex offer that follows the helper's state, and installPix2tex.
import { OCR_CAPABILITY, type HelperProgress, type HelperState, type ILatexHelper } from "@labshelf/core/helper";
import type { ILogger, PaperRecord } from "@labshelf/core";
import { createBrowserEquationPort } from "../../src/equations/equationPort";
import { MemoryFolderFs } from "../storage/memoryFolderFs";

type OcrResult = { ok: true; latex: string } | { ok: false; reason: "missing" | "limit" | "failed" | "unsupported" | "cancelled"; message: string };
type OnProgress = (progress: HelperProgress) => void;

const READY_WITH_OCR = { state: "ready", helperVersion: "1.2.0", tex: { source: "tinytex", complete: true }, host: "helper", capabilities: [OCR_CAPABILITY] } as HelperState;
const READY_OLD = { state: "ready", helperVersion: "1.0.0", tex: { source: "tinytex", complete: true }, host: "helper" } as HelperState;
const READY_OTHER_CAPS = { ...READY_OLD, capabilities: ["printPdf"] } as HelperState;
const NOT_INSTALLED: HelperState = { state: "not-installed" };
const UPDATE_HELPER = { state: "update-helper", protocol: 1, host: "helper" } as HelperState;
const UPDATE_EXTENSION: HelperState = { state: "update-extension", protocol: 9 };

interface FakeOptions {
  /** What connect() settles with and status() then returns; "reject" makes connect throw and leaves status undefined. */
  state: HelperState | "reject";
  /** Whether status() already answers before any connect(). */
  connected?: boolean;
  /** One answer per ocr call, the last one repeating. */
  ocr?: Array<OcrResult | (() => Promise<OcrResult>)>;
  install?: (onProgress: OnProgress) => Promise<void>;
}

function fakeHelper(options: FakeOptions) {
  let current: HelperState | undefined = options.connected && options.state !== "reject" ? options.state : undefined;
  const answers = options.ocr ?? [{ ok: true, latex: "x" }];
  const calls = { connect: 0, ocr: [] as Array<{ png: Uint8Array; signal: AbortSignal }>, install: 0 };
  const helper = {
    connect: async () => {
      calls.connect++;
      if (options.state === "reject") { throw new Error("no native host"); }
      current = options.state;
      return current;
    },
    status: () => current,
    ocr: async (png: Uint8Array, signal: AbortSignal) => {
      calls.ocr.push({ png, signal });
      const answer = answers[Math.min(calls.ocr.length - 1, answers.length - 1)]!;
      return typeof answer === "function" ? answer() : answer;
    },
    installPix2tex: async (onProgress: OnProgress) => {
      calls.install++;
      await options.install?.(onProgress);
    },
  };
  return { helper: helper as unknown as ILatexHelper, calls };
}

const paper = { id: "paper-1", title: "No arXiv here", path: "papers/no-arxiv", citeKey: "none2024", status: "unread" } as PaperRecord;
const request = (png: Uint8Array = new Uint8Array([137, 80, 78, 71])) => ({
  paperId: "paper-1",
  pageNumber: 2,
  rect: { x0: 10, x1: 200, yTop: 300, yBottom: 250 },
  text: "E = mc2",
  png,
});
const noProgress = (): void => undefined;

function setup(helperOptions: FakeOptions | undefined, withSetupOpener = true) {
  const fake = helperOptions && fakeHelper(helperOptions);
  const logger = { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
  const openHelperSetup = jest.fn();
  const port = createBrowserEquationPort({
    fs: new MemoryFolderFs(),
    paper,
    logger: logger as unknown as ILogger,
    ...(fake ? { helper: () => fake.helper } : {}),
    ...(withSetupOpener ? { openHelperSetup } : {}),
  });
  return { port, calls: fake?.calls, logger, openHelperSetup };
}

const offersOf = (outcome: Awaited<ReturnType<ReturnType<typeof setup>["port"]["extract"]>>) => {
  if (outcome.kind !== "unavailable") { throw new Error(`expected unavailable, got ${JSON.stringify(outcome)}`); }
  return outcome.offers;
};

describe("createBrowserEquationPort with a helper", () => {
  it("5.2a returns the LaTeX the helper reads from the image, tagged as pix2tex", async () => {
    const { port } = setup({ state: READY_WITH_OCR, ocr: [{ ok: true, latex: "E = mc^2" }] });
    expect(await port.extract(request(), noProgress)).toEqual({ kind: "latex", latex: "E = mc^2", source: "pix2tex" });
  });

  it("5.2a hands the request image and the caller's signal to the helper's ocr", async () => {
    const png = new Uint8Array([1, 2, 3, 4, 5]);
    const controller = new AbortController();
    const { port, calls } = setup({ state: READY_WITH_OCR });
    await port.extract(request(png), noProgress, controller.signal);
    expect(calls!.ocr).toHaveLength(1);
    expect(calls!.ocr[0]!.png).toEqual(png);
    expect(calls!.ocr[0]!.signal).toBe(controller.signal);
  });

  it("5.2a passes the helper an abort signal when the caller gives none", async () => {
    const { port, calls } = setup({ state: READY_WITH_OCR });
    await port.extract(request(), noProgress);
    expect(typeof calls!.ocr[0]!.signal.aborted).toBe("boolean");
  });

  it("5.2a connects to the helper when its status is not known yet", async () => {
    const { port, calls } = setup({ state: READY_WITH_OCR, connected: false });
    const outcome = await port.extract(request(), noProgress);
    expect(calls!.connect).toBe(1);
    expect(outcome).toMatchObject({ kind: "latex", source: "pix2tex" });
  });

  it("5.2a does not connect again when the helper already has a status", async () => {
    const { port, calls } = setup({ state: READY_WITH_OCR, connected: true });
    await port.extract(request(), noProgress);
    expect(calls!.connect).toBe(0);
  });

  it("5.2a offers installHelper, without calling ocr, when connecting to the helper is rejected", async () => {
    const { port, calls } = setup({ state: "reject" });
    const outcome = await port.extract(request(), noProgress);
    expect(offersOf(outcome)).toEqual({ pix2tex: "installHelper", aiKey: false });
    expect(calls!.ocr).toHaveLength(0);
  });

  it.each([
    ["not installed", NOT_INSTALLED],
    ["needs an update", UPDATE_HELPER],
    ["needs a newer extension", UPDATE_EXTENSION],
  ])("5.2a offers installHelper when the helper is %s", async (_name, state) => {
    const { port, calls } = setup({ state });
    const outcome = await port.extract(request(), noProgress);
    expect(offersOf(outcome)).toEqual({ pix2tex: "installHelper", aiKey: false });
    expect(calls!.ocr).toHaveLength(0);
  });

  it.each([
    ["no capabilities list", READY_OLD],
    ["other capabilities only", READY_OTHER_CAPS],
  ])("5.2a offers installHelper for a ready helper with %s and never calls its ocr", async (_name, state) => {
    const { port, calls } = setup({ state });
    const outcome = await port.extract(request(), noProgress);
    expect(offersOf(outcome)).toEqual({ pix2tex: "installHelper", aiKey: false });
    expect(calls!.ocr).toHaveLength(0);
  });

  it("5.2a offers install when the capable helper answers that pix2tex is missing", async () => {
    const { port } = setup({ state: READY_WITH_OCR, ocr: [{ ok: false, reason: "missing", message: "pix2tex is not installed" }] });
    const outcome = await port.extract(request(), noProgress);
    expect(offersOf(outcome)).toEqual({ pix2tex: "install", aiKey: false });
  });

  it("5.2a keeps offering install on a later extraction while ocr still says missing", async () => {
    const { port } = setup({ state: READY_WITH_OCR, ocr: [{ ok: false, reason: "missing", message: "pix2tex is not installed" }] });
    await port.extract(request(), noProgress);
    expect(offersOf(await port.extract(request(), noProgress)).pix2tex).toBe("install");
  });

  it.each(["failed", "limit", "unsupported", "cancelled"] as const)("5.2a logs the %s message of ocr and offers none, not install", async (reason) => {
    const { port, logger } = setup({ state: READY_WITH_OCR, ocr: [{ ok: false, reason, message: `ocr says ${reason}` }] });
    const outcome = await port.extract(request(), noProgress);
    expect(offersOf(outcome)).toEqual({ pix2tex: "none", aiKey: false });
    const errors = logger.error.mock.calls.map((call) => call[1]);
    expect(errors.some((e) => e instanceof Error && e.message === `ocr says ${reason}`)).toBe(true);
  });
});

describe("createBrowserEquationPort without a helper", () => {
  it("5.2a offers none for pix2tex and no AI key, as before", async () => {
    const { port } = setup(undefined);
    const outcome = await port.extract(request(), noProgress);
    expect(offersOf(outcome)).toEqual({ pix2tex: "none", aiKey: false });
  });
});

describe("createBrowserEquationPort installPix2tex", () => {
  it("5.2a opens the helper setup and resolves false when no helper was given", async () => {
    const { port, openHelperSetup } = setup(undefined);
    await expect(port.installPix2tex!(noProgress)).resolves.toBe(false);
    expect(openHelperSetup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not installed", NOT_INSTALLED],
    ["needs an update", UPDATE_HELPER],
    ["ready without the ocr capability", READY_OLD],
  ])("5.2a opens the helper setup, resolves false and installs nothing when the helper is %s", async (_name, state) => {
    const { port, calls, openHelperSetup } = setup({ state, connected: true });
    await expect(port.installPix2tex!(noProgress)).resolves.toBe(false);
    expect(openHelperSetup).toHaveBeenCalledTimes(1);
    expect(calls!.install).toBe(0);
  });

  it("5.2a resolves false without throwing when the helper is unusable and no setup opener was given", async () => {
    const { port } = setup({ state: NOT_INSTALLED, connected: true }, false);
    await expect(port.installPix2tex!(noProgress)).resolves.toBe(false);
  });

  it("5.2a runs the helper's installPix2tex and resolves true without opening the setup", async () => {
    const { port, calls, openHelperSetup } = setup({ state: READY_WITH_OCR, connected: true });
    await expect(port.installPix2tex!(noProgress)).resolves.toBe(true);
    expect(calls!.install).toBe(1);
    expect(openHelperSetup).not.toHaveBeenCalled();
  });

  it("5.2a forwards each progress message and fraction of the install", async () => {
    const { port } = setup({
      state: READY_WITH_OCR,
      connected: true,
      install: async (onProgress) => {
        onProgress({ phase: "python", message: "Downloading pix2tex", fraction: 0.25 } as HelperProgress);
        onProgress({ phase: "python", message: "Installing pix2tex", fraction: 1 } as HelperProgress);
      },
    });
    const seen: Array<[string, number | undefined]> = [];
    await port.installPix2tex!((message, fraction) => { seen.push([message, fraction]); });
    expect(seen).toEqual([["Downloading pix2tex", 0.25], ["Installing pix2tex", 1]]);
  });

  it("5.2a forwards a progress without a fraction as a message with no fraction", async () => {
    const { port } = setup({
      state: READY_WITH_OCR,
      connected: true,
      install: async (onProgress) => { onProgress({ phase: "python", message: "Working" } as HelperProgress); },
    });
    const seen: Array<[string, number | undefined]> = [];
    await port.installPix2tex!((message, fraction) => { seen.push([message, fraction]); });
    expect(seen).toEqual([["Working", undefined]]);
  });

  it("5.2a rejects with the helper's error when the install fails", async () => {
    const { port } = setup({ state: READY_WITH_OCR, connected: true, install: async () => { throw new Error("pip failed"); } });
    await expect(port.installPix2tex!(noProgress)).rejects.toThrow("pip failed");
  });

  it("5.2a stops offering install once the install resolved, so the next extraction reads again", async () => {
    const { port, calls } = setup({
      state: READY_WITH_OCR,
      ocr: [{ ok: false, reason: "missing", message: "pix2tex is not installed" }, { ok: true, latex: "a + b" }],
    });
    expect(offersOf(await port.extract(request(), noProgress)).pix2tex).toBe("install");
    await expect(port.installPix2tex!(noProgress)).resolves.toBe(true);
    const after = await port.extract(request(), noProgress);
    expect(calls!.ocr).toHaveLength(2);
    expect(after).toEqual({ kind: "latex", latex: "a + b", source: "pix2tex" });
  });

  it("5.2a keeps offering install after a failed install", async () => {
    const { port } = setup({
      state: READY_WITH_OCR,
      install: async () => { throw new Error("pip failed"); },
      ocr: [{ ok: false, reason: "missing", message: "pix2tex is not installed" }],
    });
    await port.extract(request(), noProgress);
    await expect(port.installPix2tex!(noProgress)).rejects.toThrow("pip failed");
    expect(offersOf(await port.extract(request(), noProgress)).pix2tex).toBe("install");
  });
});
