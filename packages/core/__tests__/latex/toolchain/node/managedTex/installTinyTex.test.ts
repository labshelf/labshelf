import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

const mockPin = { sha256: "" };

jest.mock("../../../../../src/latex/toolchain", () => ({
  findTinyTexFile: (platform: string, arch: string) => (platform === "linux" || platform === "darwin") && arch === "x64"
    ? {
      version: "2026.10",
      name: "TinyTeX-1-linux-x86_64-v2026.10.tar.xz",
      url: "https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/TinyTeX-1-linux-x86_64-v2026.10.tar.xz",
      sha256: mockPin.sha256,
    }
    : undefined,
}));

import { installTinyTex, type RunFile } from "../../../../../src/latex/node/texInstallers";
import { asLogger, createTexFixture, TINYTEX_URL, type TexFixture } from "./fakeTex";

const TLMGR = { rollover: false, installed: [] };

function pretendArch(value: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "arch", { value, configurable: true });
  return () => { if (original) { Object.defineProperty(process, "arch", original); } };
}

describe("installTinyTex", () => {
  let fixture: TexFixture;
  let restore: Array<() => void>;
  beforeEach(async () => {
    fixture = await createTexFixture();
    // The pin mock has x64 assets only.
    restore = [pretendArch("x64")];
  });
  afterEach(async () => {
    restore.forEach((undo) => undo());
    await fixture.cleanup();
  });

  const install = (progress: Array<number | null> = [], platform: NodeJS.Platform = "linux", execFileImpl?: RunFile) => installTinyTex(
    { fetchImpl: fixture.fetchImpl, logger: asLogger(fixture.logger), platform, ...(execFileImpl ? { execFileImpl } : {}) },
    { texRoot: fixture.texRoot, onProgress: (fraction) => { progress.push(fraction); } },
  );

  it("unpacks the release archive into tex/tinytex and leaves no staging behind", async () => {
    mockPin.sha256 = await fixture.serveTinyTex(2026, TLMGR);
    const progress: Array<number | null> = [];
    await install(progress);
    expect(existsSync(join(fixture.texRoot, "tinytex", "bin", "x86_64-linux", "tlmgr"))).toBe(true);
    expect(existsSync(join(fixture.texRoot, "tinytex", "release-texlive.txt"))).toBe(true);
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(fixture.texRoot)).toEqual(["tinytex"]);
    expect(progress).toContain(null);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("replaces an older tex/tinytex", async () => {
    mockPin.sha256 = await fixture.serveTinyTex(2025, TLMGR);
    await install();
    mockPin.sha256 = await fixture.serveTinyTex(2026, TLMGR);
    await install();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(fixture.texRoot, "tinytex", "release-texlive.txt"), "utf8")).toContain("2026");
  });

  it("rejects an archive whose SHA-256 differs from the pin, logs both hashes and installs nothing", async () => {
    await fixture.serveTinyTex(2026, TLMGR);
    mockPin.sha256 = createHash("sha256").update("something else").digest("hex");
    await expect(install()).rejects.toThrow(/Checksum mismatch/);
    expect(existsSync(join(fixture.texRoot, "tinytex"))).toBe(false);
    expect(fixture.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.stringMatching(/checksum/i), expect.objectContaining({
      asset: "TinyTeX-1-linux-x86_64-v2026.10.tar.xz", url: TINYTEX_URL, expected: mockPin.sha256, error: expect.stringMatching(/got [0-9a-f]{64}/),
    }));
  });

  it("asks GitHub for nothing but the pinned asset", async () => {
    mockPin.sha256 = await fixture.serveTinyTex(2026, TLMGR);
    const fetched: string[] = [];
    const fetchImpl = fixture.fetchImpl;
    fixture.fetchImpl = (url) => { fetched.push(url); return fetchImpl(url); };
    await installTinyTex({ fetchImpl: fixture.fetchImpl, logger: asLogger(fixture.logger), platform: "linux" }, { texRoot: fixture.texRoot, onProgress: () => undefined });
    expect(fetched).toEqual([TINYTEX_URL]);
  });

  it("refuses a platform without a pinned asset", async () => {
    await fixture.serveTinyTex(2026, TLMGR);
    restore.push(pretendArch("ia32"));
    await expect(install()).rejects.toThrow(/no build for linux-ia32/);
  });

  it("clears the quarantine attribute from the installed folder on macOS", async () => {
    mockPin.sha256 = await fixture.serveTinyTex(2026, TLMGR);
    const exec = jest.fn(async () => ({}));
    await install([], "darwin", exec);
    expect(exec).toHaveBeenCalledWith("/usr/bin/xattr", ["-dr", "com.apple.quarantine", join(fixture.texRoot, "tinytex")]);
  });

  it("does not run xattr elsewhere", async () => {
    mockPin.sha256 = await fixture.serveTinyTex(2026, TLMGR);
    const exec = jest.fn(async () => ({}));
    await install([], "linux", exec);
    expect(exec).not.toHaveBeenCalled();
  });

  it("logs an xattr failure and still finishes the install", async () => {
    mockPin.sha256 = await fixture.serveTinyTex(2026, TLMGR);
    const exec = jest.fn(async () => { throw new Error("Operation not permitted"); });
    await install([], "darwin", exec);
    expect(fixture.logger.error).toHaveBeenCalled();
    expect(existsSync(join(fixture.texRoot, "tinytex", "bin"))).toBe(true);
  });
});
