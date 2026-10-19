// Tests the provider that resolves managed, then system, then missing TeX and installs packages through tlmgr.
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { TexProvider } from "../../../../../../src/writing/latex/toolchain/index.js";
import { createManagedTexProvider, managedTexRoot, type TexInstaller } from "../../../../../../src/writing/latex/toolchain/node/managed/index.js";
import { asLogger, createTexFixture, writeTexTree, type FakeTlmgr, type TexFixture } from "./fakeTex.js";

let fx: TexFixture;
let system: { resolve: jest.Mock; installMissing: jest.Mock };
let installers: { tinytex: jest.Mock; texlive: jest.Mock };

beforeEach(async () => {
  fx = await createTexFixture();
  system = { resolve: jest.fn(async (engine: string) => ({ engine, executable: "/usr/bin/latexmk" })), installMissing: jest.fn(async () => false) };
  installers = { tinytex: jest.fn(fakeInstaller("tinytex")), texlive: jest.fn(fakeInstaller("texlive")) };
});
afterEach(() => fx.cleanup());

function fakeInstaller(kind: "tinytex" | "texlive"): TexInstaller {
  return async (run) => {
    await rm(managedTexRoot(run.texRoot, kind), { recursive: true, force: true });
    await writeTexTree(managedTexRoot(run.texRoot, kind), 2026, fx.callsFile, { rollover: false, installed: ["latex-bin"] });
    run.onProgress(1);
  };
}

const managed = (kind: "tinytex" | "texlive", year: number, tlmgr: FakeTlmgr) =>
  writeTexTree(managedTexRoot(fx.texRoot, kind), year, fx.callsFile, tlmgr);

const provider = () => createManagedTexProvider({ texRoot: fx.texRoot, logger: asLogger(fx.logger), system: system as unknown as TexProvider, installers });

describe("resolve and status", () => {
  it("prefers a managed install over the system TeX", async () => {
    const bin = await managed("tinytex", 2026, { rollover: false, installed: ["latex-bin"] });
    expect(await provider().resolve("xelatex")).toEqual({ engine: "xelatex", executable: join(bin, "latexmk"), binDir: bin });
    expect(await provider().status()).toEqual({ source: "tinytex", year: 2026, complete: false });
    expect(system.resolve).not.toHaveBeenCalled();
  });

  it("falls back to the system TeX, reported as system and complete", async () => {
    expect(await provider().resolve("pdflatex")).toEqual({ engine: "pdflatex", executable: "/usr/bin/latexmk" });
    expect(await provider().status()).toEqual({ source: "system", complete: true });
  });

  it("reports missing when neither exists", async () => {
    system.resolve.mockResolvedValue("missing");
    expect(await provider().resolve("pdflatex")).toBe("missing");
    expect(await provider().status()).toEqual({ source: "none", complete: false });
  });

  it("treats a managed TeX Live as complete", async () => {
    await managed("texlive", 2026, { rollover: false, installed: ["latex-bin"] });
    expect(await provider().status()).toEqual({ source: "texlive", year: 2026, complete: true });
  });
});

describe("installMissing", () => {
  it("searches for the file and installs its package", async () => {
    await managed("tinytex", 2026, { rollover: false, installed: [] });
    expect(await provider().installMissing("foo.sty")).toBe(true);
    expect((await fx.calls()).map((call) => call.args[0])).toEqual(["search", "install"]);
    expect((await fx.calls())[1]?.args).toEqual(["install", "foopkg"]);
  });

  it("returns false when no package provides the file", async () => {
    await managed("tinytex", 2026, { rollover: false, installed: [] });
    expect(await provider().installMissing("nothing.sty")).toBe(false);
    expect((await fx.calls()).map((call) => call.args[0])).toEqual(["search"]);
  });

  it("never runs tlmgr for a system TeX", async () => {
    expect(await provider().installMissing("foo.sty")).toBe(false);
    expect(await fx.calls()).toEqual([]);
  });
});

describe("installTex and installAllPackages", () => {
  it("runs the chosen installer and reports the managed status", async () => {
    const fractions: Array<number | null> = [];
    expect(await provider().install("tinytex", (fraction) => fractions.push(fraction))).toEqual({ source: "tinytex", year: 2026, complete: false });
    expect(fractions).toEqual([1]);
  });

  it("installs once when two runs ask for the same kind at the same time", async () => {
    const [first, second] = await Promise.all([provider().install("tinytex", () => undefined), provider().install("tinytex", () => undefined)]);
    expect(installers.tinytex).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(existsSync(join(fx.texRoot, ".lock"))).toBe(false);
  });

  it("reinstalls a kind that was already present before the request", async () => {
    await managed("tinytex", 2025, { rollover: false, installed: ["latex-bin"] });
    expect(await provider().install("tinytex", () => undefined)).toMatchObject({ source: "tinytex", year: 2026 });
    expect(installers.tinytex).toHaveBeenCalledTimes(1);
  });

  it("installs scheme-full and reports complete", async () => {
    await managed("tinytex", 2026, { rollover: false, installed: ["latex-bin"] });
    expect(await provider().installAllPackages(() => undefined)).toEqual({ source: "tinytex", year: 2026, complete: true });
    expect((await fx.calls()).find((call) => call.args[0] === "install")?.args).toEqual(["install", "scheme-full"]);
  });

  it("refuses installAllPackages without a managed TeX", async () => {
    await expect(provider().installAllPackages(() => undefined)).rejects.toMatchObject({ code: "no-managed-tex" });
  });
});

describe("annual rollover", () => {
  it("reinstalls TinyTeX with the same packages and retries", async () => {
    await managed("tinytex", 2025, { rollover: true, installed: ["latex-bin", "bibpkg"] });
    expect(await provider().installMissing("foo.sty")).toBe(true);
    expect(installers.tinytex).toHaveBeenCalledTimes(1);
    expect(await readFile(join(fx.texRoot, "tinytex-packages.txt"), "utf8")).toBe("latex-bin\nbibpkg\n");
    const installs = (await fx.calls()).filter((call) => call.args[0] === "install").map((call) => call.args.slice(1));
    expect(installs).toEqual([["latex-bin", "bibpkg"], ["foopkg"]]);
    expect(await provider().status()).toMatchObject({ source: "tinytex", year: 2026 });
  });

  it("stops a managed TeX Live with texlive-rollover and changes nothing", async () => {
    await managed("texlive", 2025, { rollover: true, installed: ["latex-bin"] });
    await expect(provider().installAllPackages(() => undefined)).rejects.toMatchObject({ code: "texlive-rollover" });
    expect(installers.texlive).not.toHaveBeenCalled();
    expect(await provider().status()).toEqual({ source: "texlive", year: 2025, complete: true });
  });
});

describe("quarantine healing on macOS", () => {
  const healing = (platform: NodeJS.Platform, exec: jest.Mock) =>
    createManagedTexProvider({ texRoot: fx.texRoot, logger: asLogger(fx.logger), system: system as unknown as TexProvider, installers, platform, execFileImpl: exec });

  it("clears the TinyTeX folder once per process when it first resolves an existing install", async () => {
    await managed("tinytex", 2026, { rollover: false, installed: [] });
    const exec = jest.fn(async () => ({}));
    const tex = healing("darwin", exec);
    await tex.resolve("xelatex");
    await tex.resolve("pdflatex");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("/usr/bin/xattr", ["-dr", "com.apple.quarantine", managedTexRoot(fx.texRoot, "tinytex")]);
  });

  it("does nothing off macOS or without a managed install", async () => {
    const exec = jest.fn(async () => ({}));
    await healing("darwin", exec).resolve("xelatex");
    await managed("tinytex", 2026, { rollover: false, installed: [] });
    await healing("linux", exec).resolve("xelatex");
    expect(exec).not.toHaveBeenCalled();
  });
});
