// Tests the reader's equation messages: the validator (png cap, page, rect, ids), the host answering every request through the optional extractEquation port, progress forwarding and the install and key re-runs.
import { isWebviewMessage, PROTOCOL_VERSION } from "../../src/reader/protocol/index";
import type { HostToWebview } from "@labshelf/core";
import type { EquationOutcome, EquationPort, EquationRequest } from "../../src/reader/hostPorts";
import { setupHost } from "./hostFixture";

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
const RECT = { x0: 72, x1: 300.5, yTop: 640, yBottom: 610.25 };

const valid = {
  command: "extractEquation",
  requestId: "e1",
  pageNumber: 3,
  rect: RECT,
  text: "E = mc^2 (4)",
  png: Buffer.from(PNG_BYTES).toString("base64"),
};

const LATEX: EquationOutcome = { kind: "latex", latex: "E=mc^{2}", source: "arxiv", number: "4" };
const UNAVAILABLE: EquationOutcome = { kind: "unavailable", offers: { pix2tex: "install", aiKey: true } };

type ResultMsg = { type: "equationResult"; requestId: string; outcome: EquationOutcome };
type ProgressMsg = { type: "equationProgress"; requestId: string; message: string; fraction?: number };
type Progress = (message: string, fraction?: number) => void;

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const send = async (host: { handle(m: never): Promise<void> | void }, message: unknown) => {
  await host.handle(message as never);
  await settle();
};

function setup(port?: Partial<EquationPort>) {
  const base = setupHost();
  if (port) { Object.assign(base.ports, { extractEquation: port }); }
  const results = (): ResultMsg[] => base.posted.filter((m: HostToWebview) => (m as { type: string }).type === "equationResult") as unknown as ResultMsg[];
  const progress = (): ProgressMsg[] => base.posted.filter((m: HostToWebview) => (m as { type: string }).type === "equationProgress") as unknown as ProgressMsg[];
  return { ...base, results, progress };
}

describe("reader equation messages: validator", () => {
  it("A6 the reader protocol version rises from 12 to 13", () => {
    expect(PROTOCOL_VERSION).toBe(13);
  });

  it("2.1a accepts a valid extractEquation", () => {
    expect(isWebviewMessage(valid)).toBe(true);
  });

  it("2.1a accepts a valid retryEquation with the same fields", () => {
    expect(isWebviewMessage({ ...valid, command: "retryEquation" })).toBe(true);
  });

  it("2.1a accepts installPix2tex with a requestId", () => {
    expect(isWebviewMessage({ command: "installPix2tex", requestId: "e1" })).toBe(true);
  });

  it("2.1a accepts addAiKey with a requestId", () => {
    expect(isWebviewMessage({ command: "addAiKey", requestId: "e1" })).toBe(true);
  });

  it("2.1a accepts a png of 1 MiB", () => {
    const png = Buffer.alloc(1024 * 1024, 7).toString("base64");
    expect(isWebviewMessage({ ...valid, png })).toBe(true);
  });

  it("2.1a accepts an empty text", () => {
    expect(isWebviewMessage({ ...valid, text: "" })).toBe(true);
  });

  it("A6 refuses extractEquation whose png decodes to more than 4 MiB", () => {
    const png = Buffer.alloc(4 * 1024 * 1024 + 1, 7).toString("base64");
    expect(isWebviewMessage({ ...valid, png })).toBe(false);
  });

  it("A6 refuses retryEquation whose png decodes to more than 4 MiB", () => {
    const png = Buffer.alloc(4 * 1024 * 1024 + 1, 7).toString("base64");
    expect(isWebviewMessage({ ...valid, command: "retryEquation", png })).toBe(false);
  });

  it.each([42, null, undefined, ["x"], { a: 1 }])("2.1a refuses extractEquation whose png is %j", (png) => {
    expect(isWebviewMessage({ ...valid, png })).toBe(false);
  });

  it("2.1a refuses extractEquation without a png", () => {
    const { png: _gone, ...rest } = valid;
    expect(isWebviewMessage(rest)).toBe(false);
  });

  it("2.1a refuses extractEquation without a requestId", () => {
    const { requestId: _gone, ...rest } = valid;
    expect(isWebviewMessage(rest)).toBe(false);
  });

  it.each(["extractEquation", "retryEquation", "installPix2tex", "addAiKey"])("2.1a refuses %s with an empty requestId", (command) => {
    expect(isWebviewMessage({ ...valid, command, requestId: "" })).toBe(false);
  });

  it.each([1, null, undefined, {}])("2.1a refuses extractEquation whose requestId is %j", (requestId) => {
    expect(isWebviewMessage({ ...valid, requestId })).toBe(false);
  });

  it.each(["installPix2tex", "addAiKey"])("2.1a refuses %s without a requestId", (command) => {
    expect(isWebviewMessage({ command })).toBe(false);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined])("2.1a refuses extractEquation whose pageNumber is %j", (pageNumber) => {
    expect(isWebviewMessage({ ...valid, pageNumber })).toBe(false);
  });

  it.each(["x0", "x1", "yTop", "yBottom"])("2.1a refuses a rect whose %s is NaN", (key) => {
    expect(isWebviewMessage({ ...valid, rect: { ...RECT, [key]: Number.NaN } })).toBe(false);
  });

  it.each(["x0", "x1", "yTop", "yBottom"])("2.1a refuses a rect whose %s is infinite", (key) => {
    expect(isWebviewMessage({ ...valid, rect: { ...RECT, [key]: Number.POSITIVE_INFINITY } })).toBe(false);
  });

  it.each(["x0", "x1", "yTop", "yBottom"])("2.1a refuses a rect without %s", (key) => {
    const rect: Record<string, number> = { ...RECT };
    delete rect[key];
    expect(isWebviewMessage({ ...valid, rect })).toBe(false);
  });

  it.each(["x0", "x1", "yTop", "yBottom"])("2.1a refuses a rect whose %s is a string", (key) => {
    expect(isWebviewMessage({ ...valid, rect: { ...RECT, [key]: "1" } })).toBe(false);
  });

  it.each([null, undefined, 5, "box", []])("2.1a refuses extractEquation whose rect is %j", (rect) => {
    expect(isWebviewMessage({ ...valid, rect })).toBe(false);
  });

  it.each([null, undefined, 5, ["x"]])("2.1a refuses extractEquation whose text is %j", (text) => {
    expect(isWebviewMessage({ ...valid, text })).toBe(false);
  });
});

describe("reader equation messages: host without the port", () => {
  it.each(["extractEquation", "retryEquation"])("2.1b %s without a port replies failed under the same requestId", async (command) => {
    const { host, results } = setup();
    await send(host, { ...valid, command });
    expect(results()).toHaveLength(1);
    expect(results()[0]!.requestId).toBe("e1");
    expect(results()[0]!.outcome.kind).toBe("failed");
  });

  it("2.1b the failed reply of a host without a port carries a reason", async () => {
    const { host, results } = setup();
    await send(host, valid);
    const outcome = results()[0]!.outcome as { kind: "failed"; reason: string };
    expect(typeof outcome.reason).toBe("string");
    expect(outcome.reason.length).toBeGreaterThan(0);
  });

  it("2.1b extractEquation without a port never answers unavailable", async () => {
    const { host, results } = setup();
    await send(host, valid);
    expect(results().map((r) => r.outcome.kind)).not.toContain("unavailable");
  });

  it.each(["installPix2tex", "addAiKey"])("2.1b %s without a port still replies a failed equationResult", async (command) => {
    const { host, results } = setup();
    await send(host, { command, requestId: "e9" });
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ requestId: "e9", outcome: { kind: "failed" } });
  });

  it("2.1b init tells the page the host has no equation port", async () => {
    const { host, posted } = setup();
    await send(host, { command: "ready-for-init" });
    const init = posted.find((m: HostToWebview) => m.type === "init") as { hasEquationPort?: boolean } | undefined;
    expect(init?.hasEquationPort ?? false).toBe(false);
  });
});

describe("reader equation messages: host with the port", () => {
  it("2.1b init tells the page the host has an equation port", async () => {
    const { host, posted } = setup({ extract: async () => LATEX });
    await send(host, { command: "ready-for-init" });
    const init = posted.find((m: HostToWebview) => m.type === "init") as { hasEquationPort?: boolean } | undefined;
    expect(init?.hasEquationPort).toBe(true);
  });

  it("2.1b forwards extractEquation to the port and replies with its outcome under the same requestId", async () => {
    const { host, results } = setup({ extract: async () => LATEX });
    await send(host, valid);
    expect(results()).toEqual([{ type: "equationResult", requestId: "e1", outcome: LATEX }]);
  });

  it("2.1b hands the port the paper id, page, rect and text of the request", async () => {
    const extract = jest.fn<Promise<EquationOutcome>, [EquationRequest, Progress, AbortSignal?]>(async () => LATEX);
    const { host } = setup({ extract });
    await send(host, valid);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]![0]).toMatchObject({ paperId: "p1", pageNumber: 3, rect: RECT, text: "E = mc^2 (4)" });
  });

  it("2.1b decodes the base64 png to the original bytes for the port", async () => {
    const extract = jest.fn<Promise<EquationOutcome>, [EquationRequest, Progress, AbortSignal?]>(async () => LATEX);
    const { host } = setup({ extract });
    await send(host, valid);
    const png = extract.mock.calls[0]![0].png;
    expect(png).toBeInstanceOf(Uint8Array);
    expect(Array.from(png)).toEqual(Array.from(PNG_BYTES));
  });

  it("2.1b forwards an unavailable outcome with its offers unchanged", async () => {
    const { host, results } = setup({ extract: async () => UNAVAILABLE });
    await send(host, valid);
    expect(results()[0]!.outcome).toEqual(UNAVAILABLE);
  });

  it("2.1b forwards a failed outcome unchanged", async () => {
    const failed: EquationOutcome = { kind: "failed", reason: "model crashed" };
    const { host, results } = setup({ extract: async () => failed });
    await send(host, valid);
    expect(results()[0]!.outcome).toEqual(failed);
  });

  it("2.1b retryEquation runs the port again and replies with the new outcome", async () => {
    const extract = jest.fn<Promise<EquationOutcome>, [EquationRequest, Progress, AbortSignal?]>()
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValueOnce(LATEX);
    const { host, results } = setup({ extract });
    await send(host, valid);
    await send(host, { ...valid, command: "retryEquation" });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(results().map((r) => r.outcome.kind)).toEqual(["unavailable", "latex"]);
    expect(results()[1]!.requestId).toBe("e1");
  });

  it("2.1b forwards the port's progress as equationProgress with the requestId", async () => {
    const { host, progress } = setup({
      extract: async (_request, onProgress) => { onProgress("Reading the source", 0.25); return LATEX; },
    });
    await send(host, valid);
    expect(progress()).toEqual([{ type: "equationProgress", requestId: "e1", message: "Reading the source", fraction: 0.25 }]);
  });

  it("2.1b forwards progress without a fraction", async () => {
    const { host, progress } = setup({
      extract: async (_request, onProgress) => { onProgress("Thinking"); return LATEX; },
    });
    await send(host, valid);
    expect(progress()).toHaveLength(1);
    expect(progress()[0]).toMatchObject({ requestId: "e1", message: "Thinking" });
    expect(progress()[0]!.fraction).toBeUndefined();
  });

  it("2.1b posts the progress before the result", async () => {
    const { host, posted } = setup({
      extract: async (_request, onProgress) => { onProgress("Working", 0.5); return LATEX; },
    });
    await send(host, valid);
    const order = posted.map((m: HostToWebview) => (m as { type: string }).type).filter((t) => t === "equationProgress" || t === "equationResult");
    expect(order).toEqual(["equationProgress", "equationResult"]);
  });

  it("2.1b keeps two requests apart by their requestIds", async () => {
    const { host, results } = setup({
      extract: async (request) => ({ kind: "latex", latex: request.text, source: "pix2tex" }),
    });
    await Promise.all([
      send(host, { ...valid, requestId: "a", text: "alpha" }),
      send(host, { ...valid, requestId: "b", text: "beta" }),
    ]);
    const byId = new Map(results().map((r) => [r.requestId, (r.outcome as { latex: string }).latex]));
    expect(byId).toEqual(new Map([["a", "alpha"], ["b", "beta"]]));
  });
});

describe("reader equation messages: errors always reply", () => {
  it("A6 an Error thrown by the port becomes a failed reply carrying its message", async () => {
    const { host, results } = setup({ extract: async () => { throw new Error("python exploded"); } });
    await send(host, valid);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.requestId).toBe("e1");
    const outcome = results()[0]!.outcome as { kind: string; reason: string };
    expect(outcome.kind).toBe("failed");
    expect(outcome.reason).toContain("python exploded");
  });

  it("A6 a non-Error rejection from the port still becomes a failed reply", async () => {
    const { host, results } = setup({ extract: () => Promise.reject("plain string") });
    await send(host, valid);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.outcome.kind).toBe("failed");
  });

  it("A6 a port that throws synchronously still gets a failed reply", async () => {
    const { host, results } = setup({ extract: () => { throw new Error("sync boom"); } });
    await send(host, valid);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.outcome.kind).toBe("failed");
  });

  it("A6 an exception from the port is logged under the reader module", async () => {
    const failure = new Error("python exploded");
    const { host, ports } = setup({ extract: async () => { throw failure; } });
    await send(host, valid);
    expect(ports.logger.error).toHaveBeenCalled();
    const [module, logged] = (ports.logger.error as jest.Mock).mock.calls[0]!;
    expect(module).toBe("reader");
    expect(logged).toBe(failure);
  });

  it("A6 each request gets exactly one equationResult even when the port reports progress then throws", async () => {
    const { host, results, progress } = setup({
      extract: async (_request, onProgress) => { onProgress("Trying", 0.1); throw new Error("late failure"); },
    });
    await send(host, valid);
    expect(progress()).toHaveLength(1);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.outcome.kind).toBe("failed");
  });
});

describe("reader equation messages: install and key re-run the request", () => {
  /** A port whose first extract is unavailable and later ones return LATEX. */
  function installable(extra: Partial<EquationPort> = {}) {
    const extract = jest.fn<Promise<EquationOutcome>, [EquationRequest, Progress, AbortSignal?]>()
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValue(LATEX);
    return { extract, ...setup({ extract, ...extra }) };
  }

  it("2.1b installPix2tex runs the port's installer", async () => {
    const installPix2tex = jest.fn(async () => true);
    const { host } = installable({ installPix2tex });
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    expect(installPix2tex).toHaveBeenCalledTimes(1);
  });

  it("2.1b installPix2tex re-runs the stored request and replies its outcome", async () => {
    const { host, extract, results } = installable({ installPix2tex: async () => true });
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract.mock.calls[1]![0]).toMatchObject({ paperId: "p1", pageNumber: 3, rect: RECT, text: "E = mc^2 (4)" });
    expect(Array.from(extract.mock.calls[1]![0].png)).toEqual(Array.from(PNG_BYTES));
    expect(results().map((r) => r.outcome.kind)).toEqual(["unavailable", "latex"]);
    expect(results()[1]).toEqual({ type: "equationResult", requestId: "e1", outcome: LATEX });
  });

  it("2.1b installPix2tex answers equationProgress with the requestId while installing", async () => {
    const { host, progress } = installable({
      installPix2tex: async (onProgress) => { onProgress("Downloading", 0.4); return true; },
    });
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    expect(progress()).toContainEqual({ type: "equationProgress", requestId: "e1", message: "Downloading", fraction: 0.4 });
  });

  it("2.1b installPix2tex posts its progress before the re-run result", async () => {
    const { host, posted } = installable({
      installPix2tex: async (onProgress) => { onProgress("Installing", 0.9); return true; },
    });
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    const kinds = posted.map((m: HostToWebview) => (m as { type: string }).type).filter((t) => t === "equationProgress" || t === "equationResult");
    expect(kinds.indexOf("equationProgress")).toBeLessThan(kinds.lastIndexOf("equationResult"));
    expect(kinds[kinds.length - 1]).toBe("equationResult");
  });

  it("2.1b installPix2tex re-runs the request of its own requestId", async () => {
    const extract = jest.fn<Promise<EquationOutcome>, [EquationRequest, Progress, AbortSignal?]>(async (request) =>
      request.text === "second" && extract.mock.calls.length <= 2 ? UNAVAILABLE : { kind: "latex", latex: request.text, source: "pix2tex" });
    const { host, results } = setup({ extract, installPix2tex: async () => true });
    await send(host, { ...valid, requestId: "a", text: "first" });
    await send(host, { ...valid, requestId: "b", text: "second" });
    await send(host, { command: "installPix2tex", requestId: "a" });
    const last = extract.mock.calls[extract.mock.calls.length - 1]![0];
    expect(last.text).toBe("first");
    expect(results()[results().length - 1]!.requestId).toBe("a");
  });

  it("2.1b addAiKey runs the port's key flow and re-runs the stored request", async () => {
    const addAiKey = jest.fn(async () => true);
    const { host, extract, results } = installable({ addAiKey });
    await send(host, valid);
    await send(host, { command: "addAiKey", requestId: "e1" });
    expect(addAiKey).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(results()[1]).toEqual({ type: "equationResult", requestId: "e1", outcome: LATEX });
  });

  it("2.1b installPix2tex without the optional method replies failed unavailable", async () => {
    const { host, results } = installable();
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    expect(results()[1]).toEqual({ type: "equationResult", requestId: "e1", outcome: { kind: "failed", reason: "unavailable" } });
  });

  it("2.1b addAiKey without the optional method replies failed unavailable", async () => {
    const { host, results } = installable();
    await send(host, valid);
    await send(host, { command: "addAiKey", requestId: "e1" });
    expect(results()[1]).toEqual({ type: "equationResult", requestId: "e1", outcome: { kind: "failed", reason: "unavailable" } });
  });

  it("2.1b installPix2tex for an unknown requestId still replies a failed result", async () => {
    const { host, results } = setup({ extract: async () => LATEX, installPix2tex: async () => true });
    await send(host, { command: "installPix2tex", requestId: "never-sent" });
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ requestId: "never-sent", outcome: { kind: "failed" } });
  });

  it("2.1b addAiKey for an unknown requestId still replies a failed result", async () => {
    const { host, results } = setup({ extract: async () => LATEX, addAiKey: async () => true });
    await send(host, { command: "addAiKey", requestId: "never-sent" });
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ requestId: "never-sent", outcome: { kind: "failed" } });
  });

  it("A6 an installer that throws still gets a failed reply and is logged", async () => {
    const failure = new Error("pip died");
    const { host, results, ports } = installable({ installPix2tex: async () => { throw failure; } });
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    const last = results()[results().length - 1]!;
    expect(last.requestId).toBe("e1");
    expect(last.outcome.kind).toBe("failed");
    expect(ports.logger.error).toHaveBeenCalled();
    expect((ports.logger.error as jest.Mock).mock.calls[0]![0]).toBe("reader");
  });

  it("A6 a key flow that throws still gets a failed reply", async () => {
    const { host, results } = installable({ addAiKey: async () => { throw new Error("keychain locked"); } });
    await send(host, valid);
    await send(host, { command: "addAiKey", requestId: "e1" });
    const last = results()[results().length - 1]!;
    expect(last.requestId).toBe("e1");
    expect(last.outcome.kind).toBe("failed");
  });

  it("A6 an installer that declines still replies to the request", async () => {
    const { host, results } = installable({ installPix2tex: async () => false });
    await send(host, valid);
    await send(host, { command: "installPix2tex", requestId: "e1" });
    expect(results().length).toBeGreaterThanOrEqual(2);
    expect(results()[results().length - 1]!.requestId).toBe("e1");
  });
});
