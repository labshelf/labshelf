// Pins the helper client: handshake, socket auth, compile page slicing, edit tracking and close handling over fakes.
// The index also exports the browser-wired factory, which loads the polyfill.
jest.mock("webextension-polyfill", () => ({ runtime: {} }));

import { createNativeLatexHelper } from "../../../src/helper/client";
import type { HelperPortFactory } from "../../../src/helper/client/connection";
import { statusFromReady } from "../../../src/helper/client/connection";
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

  it("reports the protocol mismatch without opening a socket", async () => {
    const fake = new FakeHelper();
    fake.protocol = 3;
    const { helper } = setup(fake);
    expect(await helper.connect()).toEqual({ state: "update-extension", protocol: 3 });
    expect(fake.sockets).toHaveLength(0);
  });
});

describe("statusFromReady", () => {
  const ready = { v: 2, id: "1", type: "ready" as const, host: "vscode" as const, helperVersion: "1.0.0", tex: { source: "none" as const, complete: false } };

  it("reports update-helper when the helper's protocol is lower than the page's", () => {
    expect(statusFromReady({ ...ready, protocol: 1 }, 2)).toEqual({ state: "update-helper", protocol: 1, host: "vscode" });
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
