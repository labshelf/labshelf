// Pins the client's ocr and installPix2tex over a fake helper that also answers the OCR messages.
import { helperCanOcr, type HelperState } from "../../../src/helper/helperPaths.js";
import { createNativeLatexHelper } from "../../../src/helper/helperClient.js";
import { FakeHelper, fakeLogger, type FakeSocket } from "../fakeHelperClient.js";
import { PNG } from "./ocrHandlersHarness.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

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
