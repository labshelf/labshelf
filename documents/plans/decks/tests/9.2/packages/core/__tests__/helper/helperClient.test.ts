// Pins the helper client: handshake, socket auth, compile page slicing, edit tracking, close handling, template publication and deck printing over fakes, and the print messages at the parser.
import {
  MAX_PRINT_HTML_BYTES, PROTOCOL_VERSION, createNativeLatexHelper, HelperConnection, HelperVersionError, deriveHelperStatus, helperCanPrintPdf, parseHelperMessage,
  type HelperPortFactory, type HelperState,
} from "../../src/helper/index";
import { fakeLogger, FakeHelper } from "./fakeHelperClient";

function setup(fake = new FakeHelper(), connectNative?: HelperPortFactory) {
  const logger = fakeLogger();
  const helper = createNativeLatexHelper({
    logger, extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: connectNative ?? (() => fake), openSocket: fake.openSocket,
  });
  return { fake, logger, helper };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("connect", () => {
  it("sends the origin, opens the socket on the session port and authenticates", async () => {
    const { fake, helper } = setup();
    expect(await helper.connect()).toEqual({ state: "ready", helperVersion: "1.0.0", tex: { source: "tinytex", year: 2025, complete: true }, host: "helper" });
    expect(fake.nativePosted[0]).toMatchObject({ type: "hello", extensionVersion: "0.1.0", origin: "chrome-extension://abc" });
    expect(fake.sockets.map((s) => s.url)).toEqual(["ws://127.0.0.1:4321/"]);
    expect(fake.receivedOfType("auth")[0]?.token).toBe("secret");
  });

  it.each([
    ["Chrome", "Specified native messaging host not found."],
    ["Firefox", "No such native application dev.labshelf.helper"],
  ])("maps the %s host-not-found message to not-installed", async (_browser, reason) => {
    const { fake, helper } = setup();
    fake.muteHello = true;
    const status = helper.connect();
    queueMicrotask(() => fake.closeNative(reason));
    expect(await status).toEqual({ state: "not-installed" });
  });

  it("rejects and logs any other disconnect before ready", async () => {
    const { fake, helper, logger } = setup();
    fake.muteHello = true;
    const status = helper.connect();
    queueMicrotask(() => fake.closeNative("Native host has exited."));
    await expect(status).rejects.toThrow("Native host has exited.");
    expect(logger.error).toHaveBeenCalledWith("browser.helper", expect.any(Error), expect.objectContaining({ step: "handshake" }));
  });

  it("shares one handshake between connects that overlap, so every request uses the socket the project opened on", async () => {
    const { fake, helper } = setup();
    const [first, second] = await Promise.all([helper.connect(), helper.connect()]);
    expect(second).toEqual(first);
    expect(fake.sockets).toHaveLength(1);
  });

  it("reports the protocol mismatch without opening a socket", async () => {
    const fake = new FakeHelper();
    fake.protocol = PROTOCOL_VERSION + 1;
    const { helper } = setup(fake);
    expect(await helper.connect()).toEqual({ state: "update-extension", protocol: PROTOCOL_VERSION + 1 });
    expect(fake.sockets).toHaveLength(0);
  });
});

describe("a hello refused for its protocol version", () => {
  it.each([
    ["older", PROTOCOL_VERSION - 1, { state: "update-helper", protocol: PROTOCOL_VERSION - 1, host: undefined }],
    ["newer", PROTOCOL_VERSION + 1, { state: "update-extension", protocol: PROTOCOL_VERSION + 1 }],
  ])("maps a %s helper to the program to update instead of a raw error", async (_which, v, status) => {
    const fake = new FakeHelper();
    fake.refuseHelloWithV = v;
    const { helper, logger } = setup(fake);
    expect(await helper.connect()).toEqual(status);
    expect(fake.sockets).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("HelperConnection version errors", () => {
  const channel = () => {
    let deliver: (message: unknown) => void = () => undefined;
    return { post: jest.fn(), close: jest.fn(), onMessage: (l: typeof deliver) => { deliver = l; }, onClose: () => undefined, send: (m: unknown) => deliver(m) };
  };

  it("fails a pending request with HelperVersionError carrying the helper's v, for a frame of another version", async () => {
    const ch = channel();
    const connection = new HelperConnection(ch as never, fakeLogger());
    const pending = connection.request({ type: "cancel", projectId: "p" }, () => undefined);
    ch.send({ v: PROTOCOL_VERSION - 1, id: "1", type: "ready" });
    await expect(pending).rejects.toEqual(new HelperVersionError(PROTOCOL_VERSION - 1));
  });

  it("fails a pending request with HelperVersionError when an error reply has code version", async () => {
    const ch = channel();
    const connection = new HelperConnection(ch as never, fakeLogger());
    const pending = connection.request({ type: "cancel", projectId: "p" }, () => undefined);
    ch.send({ v: PROTOCOL_VERSION, id: "1", type: "error", code: "version", message: "v is 2" });
    await expect(pending).rejects.toBeInstanceOf(HelperVersionError);
  });
});

describe("deriveHelperStatus", () => {
  const ready = { v: PROTOCOL_VERSION, id: "1", type: "ready" as const, host: "vscode" as const, helperVersion: "1.0.0", tex: { source: "none" as const, complete: false } };

  it("reports update-helper when the helper's protocol is lower than the page's", () => {
    expect(deriveHelperStatus({ ...ready, protocol: 1 }, 2)).toEqual({ state: "update-helper", protocol: 1, host: "vscode" });
  });
});

describe("compile", () => {
  const request = { projectId: "thesis", main: "main.tex", mode: "preview" as const };

  it("returns only the changed pages, cut from the payload, and forwards progress", async () => {
    const { fake, helper } = setup();
    fake.built = { status: "succeeded", pages: { pageCount: 3, pages: [{ index: 0, bytes: Uint8Array.of(1, 2) }, { index: 2, bytes: Uint8Array.of(9, 8, 7) }] } };
    await helper.connect();
    const progress: unknown[] = [];
    const result = await helper.compile(request, (p) => progress.push(p));
    expect(progress).toEqual([{ phase: "building", message: "Running pdflatex", fraction: 0.5 }]);
    expect(result).toMatchObject({ status: "succeeded", pdfSha256: "a".repeat(64), pageCount: 3 });
    expect(result.changed).toEqual([{ index: 0, bytes: Uint8Array.of(1, 2) }, { index: 2, bytes: Uint8Array.of(9, 8, 7) }]);
    expect(fake.receivedOfType("compile")[0]).toMatchObject({ projectId: "thesis", main: "main.tex", mode: "preview" });
  });

  it("sends the edited file and its line", async () => {
    const { fake, helper } = setup();
    await helper.connect();
    await helper.compile({ ...request, editedFile: "ch/a.tex", editedLine: 12 }, () => undefined);
    expect(fake.receivedOfType("compile")[0]).toMatchObject({ editedFile: "ch/a.tex", editedLine: 12 });
  });

  it("forwards haltOnError only when the request sets it", async () => {
    const { fake, helper } = setup();
    await helper.connect();
    await helper.compile({ ...request, haltOnError: false }, () => undefined);
    await helper.compile(request, () => undefined);
    expect(fake.receivedOfType("compile")[0]).toMatchObject({ haltOnError: false });
    expect(fake.receivedOfType("compile")[1]).not.toHaveProperty("haltOnError");
  });

  it("returns a failed build without pages", async () => {
    const { helper } = setup();
    await helper.connect();
    expect(await helper.compile(request, () => undefined)).toEqual({ status: "failed", problems: [], changed: [] });
  });

  it("rejects when a page lies outside the payload", async () => {
    const { fake, helper } = setup();
    fake.built = { status: "succeeded", pages: { pageCount: 1, pages: [{ index: 0, bytes: Uint8Array.of(1, 2) }], announce: [{ index: 0, offset: 1, length: 5 }] } };
    await helper.connect();
    await expect(helper.compile(request, () => undefined)).rejects.toThrow("announced page 0");
  });

  it("rejects pending requests and resets the status when the socket closes", async () => {
    const { fake, helper } = setup();
    await helper.connect();
    fake.built = { status: "failed" };
    fake.answer = () => undefined;
    const pending = helper.compile(request, () => undefined);
    await flush();
    fake.sockets[0]?.serverClose("going away");
    await expect(pending).rejects.toThrow("going away");
    expect(helper.status()).toBeUndefined();
  });
});

describe("edit", () => {
  it("sends the whole text first and changes after, and refuses changes without state", async () => {
    const { fake, helper } = setup();
    await helper.connect();
    await expect(helper.edit("thesis", "a.tex", 1, { changes: [] })).rejects.toThrow("whole text");
    await helper.edit("thesis", "a.tex", 1, { text: "hello" });
    await helper.edit("thesis", "a.tex", 2, { changes: [{ from: 0, to: 0, insert: "oh " }] });
    expect(fake.receivedOfType("edit")).toEqual([
      expect.objectContaining({ version: 1, text: "hello" }),
      expect.objectContaining({ version: 2, changes: [{ from: 0, to: 0, insert: "oh " }] }),
    ]);
  });

  it("answers a stale reply with the whole text at the same version", async () => {
    const { fake, helper } = setup();
    fake.staleChanges = true;
    await helper.connect();
    await helper.edit("thesis", "a.tex", 1, { text: "hello" });
    await helper.edit("thesis", "a.tex", 2, { changes: [{ from: 5, to: 5, insert: "!" }] });
    await flush();
    const edits = fake.receivedOfType("edit");
    expect(edits).toHaveLength(3);
    expect(edits[2]).toMatchObject({ version: 2, text: "hello!" });
  });

  it("forgets the text of a saved path", async () => {
    const { helper } = setup();
    await helper.connect();
    await helper.edit("thesis", "a.tex", 1, { text: "x" });
    await helper.save("thesis", "a.tex");
    await expect(helper.edit("thesis", "a.tex", 1, { changes: [] })).rejects.toThrow("whole text");
  });
});

describe("openProject", () => {
  it("opens a project and returns its files", async () => {
    const { helper } = setup();
    await helper.connect();
    expect(await helper.openProject("thesis", "Writing/thesis")).toEqual({ files: ["main.tex"] });
  });
});

it("renders the helper's sample and sends PNG bytes tied to the waiting publication", async () => {
  const fake = new FakeHelper();
  const helper = createNativeLatexHelper({ logger: fakeLogger(), extensionVersion: "1", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket });
  await helper.connect();
  const pdf = new Uint8Array([37, 80, 68, 70]); const png = new Uint8Array([137, 80, 78, 71]);
  const events: unknown[] = []; const render = jest.fn(async () => png);
  const pending = helper.publishTemplate("paper", { action: "check", draft: { name: "Paper", category: "article", license: "MIT", description: "Starter" } }, (event) => events.push(event), render);
  await flush();
  const request = fake.receivedOfType("publishTemplate")[0]!;
  const socket = fake.sockets[0]!;
  socket.deliver({ id: request.id, type: "templatePreview" }, pdf);
  await flush();
  expect(render).toHaveBeenCalledWith(pdf);
  const thumbnail = socket.sent.find((m) => m.message.type === "templateThumbnail")!;
  expect(thumbnail.message.requestId).toBe(request.id); expect(thumbnail.payload).toEqual(png);
  socket.deliver({ id: request.id, type: "templatePublish", done: false, event: { type: "publish.checks", checks: [{ id: "thumbnail", ok: true }], running: false } });
  socket.deliver({ id: request.id, type: "templatePublish", done: true });
  await pending;
  expect(events).toEqual([{ type: "publish.checks", checks: [{ id: "thumbnail", ok: true }], running: false }]);
  helper.disconnect();
});

it("reports a render failure to the waiting helper", async () => {
  const fake = new FakeHelper(); const logger = fakeLogger();
  const helper = createNativeLatexHelper({ logger, extensionVersion: "1", origin: "chrome-extension://abc", connectNative: () => fake, openSocket: fake.openSocket });
  const pending = helper.publishTemplate("paper", { action: "open" }, () => {}, async () => { throw new Error("Invalid PDF"); });
  await flush();
  const request = fake.receivedOfType("publishTemplate")[0]!;
  fake.sockets[0]!.deliver({ id: request.id, type: "templatePreview" }, new Uint8Array([1]));
  await flush();
  expect(fake.receivedOfType("templateThumbnail")[0]).toMatchObject({ requestId: request.id, error: "Invalid PDF" });
  fake.sockets[0]!.deliver({ id: request.id, type: "templatePublish", done: true });
  await pending; helper.disconnect();
});

// 9.2: printing a deck through LabShelf Helper.

const PRINT_ENV = (id: string) => ({ v: PROTOCOL_VERSION, id });
const READY_BODY = { type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper", tex: { source: "texlive", year: 2026, complete: true } };
const parsed = (raw: unknown, direction: "toHelper" | "toPage") => parseHelperMessage(raw, direction);
const rejection = (raw: unknown, direction: "toHelper" | "toPage") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};
const DECK_HTML = "<!doctype html><html><head><style>@page { size: 1920px 1080px; }</style></head><body><section>Slide é</section></body></html>";

describe("9.2a print messages at the parser", () => {
  it("9.2a keeps the protocol version at 11", () => {
    expect(PROTOCOL_VERSION).toBe(11);
  });

  it("9.2a sets MAX_PRINT_HTML_BYTES to 15 MiB", () => {
    expect(MAX_PRINT_HTML_BYTES).toBe(15 * 1024 * 1024);
  });

  it("9.2a accepts a printPdf with a size sent to the helper", () => {
    const message = { ...PRINT_ENV("p1"), type: "printPdf", size: "1920x1080px" };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("9.2a rejects a printPdf without a string size", () => {
    expect(rejection({ ...PRINT_ENV("p1"), type: "printPdf" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...PRINT_ENV("p1"), type: "printPdf", size: 1920 }, "toHelper")).toBe("invalid-field");
  });

  it("9.2a rejects a printPdf sent to the page as unknown-type", () => {
    expect(rejection({ ...PRINT_ENV("p1"), type: "printPdf", size: "1920x1080px" }, "toPage")).toBe("unknown-type");
  });

  it("9.2a accepts a cancelPrint naming a request id", () => {
    const message = { ...PRINT_ENV("c1"), type: "cancelPrint", requestId: "p1" };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("9.2a rejects a cancelPrint without a string requestId", () => {
    expect(rejection({ ...PRINT_ENV("c1"), type: "cancelPrint" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...PRINT_ENV("c1"), type: "cancelPrint", requestId: 7 }, "toHelper")).toBe("invalid-field");
  });

  it("9.2a accepts a pdfPrinted with its byte count sent to the page", () => {
    const message = { ...PRINT_ENV("p1"), type: "pdfPrinted", bytes: 4 };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("9.2a rejects a pdfPrinted whose bytes is not a non-negative integer", () => {
    expect(rejection({ ...PRINT_ENV("p1"), type: "pdfPrinted" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...PRINT_ENV("p1"), type: "pdfPrinted", bytes: "4" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...PRINT_ENV("p1"), type: "pdfPrinted", bytes: -1 }, "toPage")).toBe("invalid-field");
  });

  it("9.2a rejects a pdfPrinted sent to the helper as unknown-type", () => {
    expect(rejection({ ...PRINT_ENV("p1"), type: "pdfPrinted", bytes: 4 }, "toHelper")).toBe("unknown-type");
  });

  it.each(["noChromium", "limit", "failed"])("9.2a accepts a printFailed with reason %s", (reason) => {
    const message = { ...PRINT_ENV("p1"), type: "printFailed", reason, message: "No Chromium." };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("9.2a rejects a printFailed with a reason outside noChromium, limit and failed", () => {
    expect(rejection({ ...PRINT_ENV("p1"), type: "printFailed", reason: "unsupported", message: "x" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...PRINT_ENV("p1"), type: "printFailed", reason: "cancelled", message: "x" }, "toPage")).toBe("invalid-field");
  });

  it("9.2a rejects a printFailed without a string message", () => {
    expect(rejection({ ...PRINT_ENV("p1"), type: "printFailed", reason: "failed" }, "toPage")).toBe("invalid-field");
  });

  it("9.2a accepts a ready with capabilities and keeps them, unknown entries included", () => {
    const message = { ...PRINT_ENV("r1"), ...READY_BODY, capabilities: ["printPdf", "somethingLater"] };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("9.2a accepts a ready without capabilities and leaves the field absent", () => {
    const result = parsed({ ...PRINT_ENV("r1"), ...READY_BODY }, "toPage");
    expect(result.ok).toBe(true);
    expect(result.ok && result.message).not.toHaveProperty("capabilities");
  });

  it("9.2a drops the non-string entries of ready.capabilities", () => {
    const result = parsed({ ...PRINT_ENV("r1"), ...READY_BODY, capabilities: [1, "printPdf", null, { a: 1 }] }, "toPage");
    expect(result).toEqual({ ok: true, message: { ...PRINT_ENV("r1"), ...READY_BODY, capabilities: ["printPdf"] } });
  });

  it("9.2a drops a ready.capabilities that is not an array and keeps the ready", () => {
    const result = parsed({ ...PRINT_ENV("r1"), ...READY_BODY, capabilities: "printPdf" }, "toPage");
    expect(result).toEqual({ ok: true, message: { ...PRINT_ENV("r1"), ...READY_BODY } });
  });
});

function printSetup(capabilities: unknown[] | undefined = ["printPdf"]) {
  const fake = new FakeHelper();
  fake.capabilities = capabilities;
  return setup(fake);
}

describe("9.2b printPdf on the client", () => {
  it("9.2b sends printPdf with the size over the socket and the HTML as the UTF-8 payload", async () => {
    const { fake, helper } = printSetup();
    await helper.connect();
    await helper.printPdf({ html: DECK_HTML, size: "1920x1080px" }, new AbortController().signal);
    expect(fake.receivedOfType("printPdf")).toHaveLength(1);
    expect(fake.receivedOfType("printPdf")[0]).toMatchObject({ type: "printPdf", size: "1920x1080px" });
    expect(new TextDecoder().decode(fake.printPayloads[0])).toBe(DECK_HTML);
    expect(fake.nativePosted.map((m) => m.type)).toEqual(["hello"]);
  });

  it("9.2b resolves the PDF bytes from the pdfPrinted payload", async () => {
    const { fake, helper } = printSetup();
    const pdf = Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55);
    fake.printReply = { pdf };
    await helper.connect();
    const result = await helper.printPdf({ html: DECK_HTML, size: "1920x1080px" }, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(result.ok && Array.from(result.pdf)).toEqual(Array.from(pdf));
  });

  it.each([
    ["noChromium", "No Chromium-based browser was found."],
    ["limit", "The PDF is too large."],
    ["failed", "Chromium crashed."],
  ] as const)("9.2b resolves a printFailed %s as that failure", async (reason, message) => {
    const { fake, helper } = printSetup();
    fake.printReply = { reason, message };
    await helper.connect();
    expect(await helper.printPdf({ html: DECK_HTML, size: "1920x1080px" }, new AbortController().signal)).toEqual({ ok: false, reason, message });
  });

  it("9.2b resolves unsupported without sending when the helper's ready has no printPdf capability", async () => {
    const { fake, helper } = printSetup(undefined);
    await helper.connect();
    expect(await helper.printPdf({ html: DECK_HTML, size: "1920x1080px" }, new AbortController().signal))
      .toEqual({ ok: false, reason: "unsupported", message: "Update LabShelf Helper to export PDFs." });
    expect(fake.receivedOfType("printPdf")).toHaveLength(0);
  });

  it("9.2b resolves unsupported when the helper announces only other capabilities", async () => {
    const { fake, helper } = printSetup(["somethingElse"]);
    await helper.connect();
    expect(await helper.printPdf({ html: DECK_HTML, size: "1920x1080px" }, new AbortController().signal))
      .toEqual({ ok: false, reason: "unsupported", message: "Update LabShelf Helper to export PDFs." });
    expect(fake.receivedOfType("printPdf")).toHaveLength(0);
  });

  it("9.2b refuses HTML over MAX_PRINT_HTML_BYTES with limit before sending", async () => {
    const { fake, helper } = printSetup();
    await helper.connect();
    const html = "a".repeat(MAX_PRINT_HTML_BYTES + 1);
    expect(await helper.printPdf({ html, size: "1920x1080px" }, new AbortController().signal))
      .toEqual({ ok: false, reason: "limit", message: "The deck is too large to print through LabShelf Helper." });
    expect(fake.receivedOfType("printPdf")).toHaveLength(0);
  });

  it("9.2b counts the limit in UTF-8 bytes, not characters", async () => {
    const { fake, helper } = printSetup();
    await helper.connect();
    const html = "é".repeat(MAX_PRINT_HTML_BYTES / 2 + 1);
    expect(html.length).toBeLessThan(MAX_PRINT_HTML_BYTES);
    expect(await helper.printPdf({ html, size: "1920x1080px" }, new AbortController().signal))
      .toEqual({ ok: false, reason: "limit", message: "The deck is too large to print through LabShelf Helper." });
    expect(fake.receivedOfType("printPdf")).toHaveLength(0);
  });

  it("9.2b sends HTML of exactly MAX_PRINT_HTML_BYTES", async () => {
    const { fake, helper } = printSetup();
    await helper.connect();
    const html = "a".repeat(MAX_PRINT_HTML_BYTES);
    const result = await helper.printPdf({ html, size: "1920x1080px" }, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(fake.printPayloads[0]?.length).toBe(MAX_PRINT_HTML_BYTES);
  });

  it("9.2b on abort sends cancelPrint for the request and resolves cancelled without waiting for a reply", async () => {
    const { fake, helper } = printSetup();
    fake.printReply = "mute";
    await helper.connect();
    const controller = new AbortController();
    const pending = helper.printPdf({ html: DECK_HTML, size: "1920x1080px" }, controller.signal);
    await flush();
    const request = fake.receivedOfType("printPdf")[0]!;
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "cancelled", message: "Cancelled." });
    await flush();
    expect(fake.receivedOfType("cancelPrint")).toEqual([expect.objectContaining({ type: "cancelPrint", requestId: request.id })]);
  });
});

describe("9.2d the printPdf capability", () => {
  const ready: Extract<HelperState, { state: "ready" }> = { state: "ready", helperVersion: "1.0.0", tex: { source: "tinytex", year: 2025, complete: true }, host: "helper" };

  it("9.2d helperCanPrintPdf is false without a state", () => {
    expect(helperCanPrintPdf(undefined)).toBe(false);
  });

  it("9.2d helperCanPrintPdf is false for states that are not ready", () => {
    expect(helperCanPrintPdf({ state: "not-installed" })).toBe(false);
    expect(helperCanPrintPdf({ state: "update-helper", protocol: 10, host: "helper" })).toBe(false);
    expect(helperCanPrintPdf({ state: "update-extension", protocol: 12 })).toBe(false);
  });

  it("9.2d helperCanPrintPdf is false for a ready state without printPdf", () => {
    expect(helperCanPrintPdf(ready)).toBe(false);
    expect(helperCanPrintPdf({ ...ready, capabilities: [] })).toBe(false);
    expect(helperCanPrintPdf({ ...ready, capabilities: ["somethingElse"] })).toBe(false);
  });

  it("9.2d helperCanPrintPdf is true for a ready state announcing printPdf", () => {
    expect(helperCanPrintPdf({ ...ready, capabilities: ["somethingElse", "printPdf"] })).toBe(true);
  });

  it("9.2d deriveHelperStatus carries the ready's capabilities", () => {
    const message = { v: PROTOCOL_VERSION, id: "1", type: "ready" as const, protocol: PROTOCOL_VERSION, host: "helper" as const, helperVersion: "1.0.0", tex: { source: "none" as const, complete: false }, capabilities: ["printPdf"] };
    expect(deriveHelperStatus(message, PROTOCOL_VERSION)).toEqual({ state: "ready", helperVersion: "1.0.0", tex: { source: "none", complete: false }, host: "helper", capabilities: ["printPdf"] });
  });

  it("9.2d deriveHelperStatus leaves capabilities out when the ready has none", () => {
    const message = { v: PROTOCOL_VERSION, id: "1", type: "ready" as const, protocol: PROTOCOL_VERSION, host: "helper" as const, helperVersion: "1.0.0", tex: { source: "none" as const, complete: false } };
    expect(deriveHelperStatus(message, PROTOCOL_VERSION)).not.toHaveProperty("capabilities");
  });

  it("9.2d the client status keeps the capabilities the hello ready announced", async () => {
    const { helper } = printSetup();
    const status = await helper.connect();
    expect(status).toMatchObject({ state: "ready", capabilities: ["printPdf"] });
    expect(helperCanPrintPdf(helper.status())).toBe(true);
  });

  it("9.2d the client status keeps the capabilities when a later ready omits them", async () => {
    const { helper } = printSetup();
    await helper.connect();
    await helper.installPython(() => undefined);
    expect(helper.status()).toMatchObject({ state: "ready", python: "installed", capabilities: ["printPdf"] });
    expect(helperCanPrintPdf(helper.status())).toBe(true);
  });
});
