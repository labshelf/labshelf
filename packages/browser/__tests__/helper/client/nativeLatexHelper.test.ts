// Pins the native helper client: status mapping, delta sync, PDF reassembly and failure handling over a fake port.
// The index also exports the browser-wired factory, which loads the polyfill.
jest.mock("webextension-polyfill", () => ({ runtime: {} }));

import { webcrypto } from "node:crypto";
import { createNativeLatexHelper, type HelperPortFactory } from "../../../src/helper/client";
import { statusFromReady } from "../../../src/helper/client/connection";
import { fakeLogger, FakeHelper } from "./fakeHelper";

const encoder = new TextEncoder();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function setup(fake = new FakeHelper(), connectNative?: HelperPortFactory) {
  const logger = fakeLogger();
  const helper = createNativeLatexHelper({ logger, extensionVersion: "0.1.0", connectNative: connectNative ?? (() => fake) });
  return { fake, logger, helper };
}

function project(files: Record<string, string>) {
  return {
    projectId: "thesis",
    main: "main.tex",
    engine: "pdflatex" as const,
    files: Object.entries(files).map(([path, text]) => ({ path, bytes: encoder.encode(text) })),
  };
}

function bigPdf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) { bytes[i] = (i * 31 + 7) % 256; }
  return bytes;
}

describe("connect", () => {
  it.each([
    ["Chrome", "Specified native messaging host not found."],
    ["Firefox", "No such native application dev.labshelf.helper"],
  ])("maps the %s host-not-found message to not-installed", async (_browser, reason) => {
    const { fake, helper } = setup();
    fake.mute.add("hello");
    const status = helper.connect();
    queueMicrotask(() => fake.close(reason));
    expect(await status).toEqual({ state: "not-installed" });
    expect(helper.status()).toEqual({ state: "not-installed" });
  });

  it("rejects and logs any other disconnect before ready", async () => {
    const { fake, helper, logger } = setup();
    fake.mute.add("hello");
    const status = helper.connect();
    queueMicrotask(() => fake.close("Native host has exited."));
    await expect(status).rejects.toThrow("Native host has exited.");
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ step: "hello" }));
  });

  it("maps a connect that throws with a not-found message to not-installed", async () => {
    const { helper } = setup(undefined, () => { throw new Error("No such native application dev.labshelf.helper"); });
    expect(await helper.connect()).toEqual({ state: "not-installed" });
  });

  it("reports ready with the helper version and TeX status", async () => {
    const { helper } = setup();
    expect(await helper.connect()).toEqual({ state: "ready", helperVersion: "1.0.0", tex: { source: "tinytex", year: 2025, complete: true }, host: "helper" });
  });

  it("reports update-extension when the helper's protocol is higher", async () => {
    const fake = new FakeHelper();
    fake.protocol = 2;
    expect(await setup(fake).helper.connect()).toEqual({ state: "update-extension", protocol: 2 });
  });
});

describe("statusFromReady", () => {
  const ready = { v: 1, id: "1", type: "ready" as const, host: "vscode" as const, helperVersion: "1.0.0", tex: { source: "none" as const, complete: false } };

  it("reports update-helper when the helper's protocol is lower than the page's", () => {
    expect(statusFromReady({ ...ready, protocol: 1 }, 2)).toEqual({ state: "update-helper", protocol: 1, host: "vscode" });
  });

  it("reports update-extension when it is higher, and ready when equal", () => {
    expect(statusFromReady({ ...ready, protocol: 3 }, 2)).toEqual({ state: "update-extension", protocol: 3 });
    expect(statusFromReady({ ...ready, protocol: 2 }, 2)).toMatchObject({ state: "ready", host: "vscode" });
  });
});

describe("compile", () => {
  it("sends only the files the helper lacks", async () => {
    const { fake, helper } = setup();
    await helper.connect();
    await helper.compile(project({ "main.tex": "one", "refs.bib": "two" }), () => undefined);
    expect(fake.postedOfType("file").map((m) => m.path).sort()).toEqual(["main.tex", "refs.bib"]);
    fake.posted.length = 0;
    await helper.compile(project({ "main.tex": "changed", "refs.bib": "two" }), () => undefined);
    expect(fake.postedOfType("file").map((m) => m.path)).toEqual(["main.tex"]);
    expect(fake.postedOfType("sync")[0]?.files).toEqual([
      { path: "main.tex", sha256: await sha256Hex(encoder.encode("changed")), size: 7 },
      { path: "refs.bib", sha256: await sha256Hex(encoder.encode("two")), size: 3 },
    ]);
  });

  it("reassembles a 3 MB PDF whose SHA-256 matches", async () => {
    const pdf = bigPdf(3 * 1024 * 1024);
    const fake = new FakeHelper();
    fake.built = { status: "succeeded", pdf, pdfSha256: await sha256Hex(pdf) };
    const { helper } = setup(fake);
    await helper.connect();
    const result = await helper.compile(project({ "main.tex": "x" }), () => undefined);
    expect(result.status).toBe("succeeded");
    expect(result.status === "succeeded" && Buffer.from(result.pdf).equals(Buffer.from(pdf))).toBe(true);
  });

  it("rejects a PDF whose SHA-256 differs from the one announced", async () => {
    const fake = new FakeHelper();
    fake.built = { status: "succeeded", pdf: bigPdf(1000), pdfSha256: "0".repeat(64) };
    const { helper, logger } = setup(fake);
    await helper.connect();
    await expect(helper.compile(project({ "main.tex": "x" }), () => undefined)).rejects.toThrow(/SHA-256/);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: expect.stringContaining("SHA-256") }), expect.objectContaining({ operation: "compile" }));
  });

  it("returns a failed build without a PDF and forwards progress", async () => {
    const { helper } = setup();
    await helper.connect();
    const progress: unknown[] = [];
    const result = await helper.compile(project({ "main.tex": "x" }), (p) => progress.push(p));
    expect(result).toEqual({ status: "failed", problems: [] });
    expect(progress).toEqual([{ phase: "building", message: "Running pdflatex", fraction: 0.5 }]);
  });

  it("rejects pending requests when the port closes mid-build", async () => {
    const fake = new FakeHelper();
    const { helper } = setup(fake);
    await helper.connect();
    fake.mute.add("build");
    const compiling = helper.compile(project({ "main.tex": "x" }), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    fake.close("Native host has exited.");
    await expect(compiling).rejects.toThrow(/closed the connection.*build.*Native host has exited/s);
  });

  it("sends cancel without waiting for a reply", async () => {
    const { fake, helper } = setup();
    await helper.connect();
    await helper.cancel("thesis");
    expect(fake.postedOfType("cancel")).toHaveLength(1);
    expect(fake.postedOfType("cancel")[0]?.projectId).toBe("thesis");
  });
});

describe("install", () => {
  it("installs TeX and refreshes the status from the ready reply", async () => {
    const { helper } = setup(new FakeHelper({ source: "none", complete: false }));
    await helper.connect();
    const progress: unknown[] = [];
    await helper.installTex("tinytex", (p) => progress.push(p));
    expect(progress).toEqual([{ phase: "installing-tex", message: "Installing" }]);
    expect(helper.status()).toEqual({ state: "ready", helperVersion: "1.0.0", tex: { source: "tinytex", year: 2025, complete: false }, host: "helper" });
  });

  it("installs every package and marks the TeX complete", async () => {
    const { helper } = setup();
    await helper.connect();
    await helper.installAllPackages(() => undefined);
    expect(helper.status()).toMatchObject({ state: "ready", tex: { complete: true } });
  });
});
