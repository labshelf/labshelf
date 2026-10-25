// Pins the helper client: handshake, socket auth, compile page slicing, edit tracking and close handling over fakes.
// The index also exports the browser-wired factory, which loads the polyfill.
jest.mock("webextension-polyfill", () => ({ runtime: {} }));

import { PROTOCOL_VERSION } from "@labshelf/core/helper";
import { createNativeLatexHelper } from "../../../src/helper/client";
import type { HelperPortFactory } from "../../../src/helper/client/connection";
import { HelperConnection, HelperVersionError, deriveHelperStatus } from "../../../src/helper/client/connection";
import { fakeLogger, FakeHelper } from "./fakeHelper";

function setup(fake = new FakeHelper(), connectNative?: HelperPortFactory) {
  const logger = fakeLogger();
  const helper = createNativeLatexHelper({
    logger, extensionVersion: "0.1.0", origin: "chrome-extension://abc", connectNative: connectNative ?? (() => fake), webSocket: fake.socketClass,
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
    expect(fake.sockets[0]?.binaryType).toBe("arraybuffer");
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
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ step: "handshake" }));
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
