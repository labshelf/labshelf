import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createSpellChecker } from "../../../src/writing/proofing/checker.js";
import type { SpellChecker } from "../../../src/writing/proofing/checker.js";
import type { DictionaryFiles } from "../../../src/writing/proofing/port.js";
import { stemIndex } from "../../../src/writing/proofing/stems.js";

// Literal specifiers, so knip sees core's dev dependencies.
function readDictionary(entry: string): DictionaryFiles {
  const folder = dirname(entry);
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const pt = readDictionary(require.resolve("dictionary-pt"));
const en = readDictionary(require.resolve("dictionary-en"));

describe("stem index", () => {
  it("builds the pt-BR index quickly, sorted by code units and without flags", () => {
    const dic = new Uint8Array(pt.dic);
    const started = performance.now();
    const index = stemIndex(dic);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(index.stems.length).toBeGreaterThan(100_000);
    expect(index.stems.some((stem) => stem.includes("/"))).toBe(false);
    for (let i = 1; i < 2000; i += 1) { expect((index.stems[i - 1] ?? "") < (index.stems[i] ?? "")).toBe(true); }
    expect(index.stems).toContain("casar");
    expect(index.stems).toContain("computar");
  });
});

describe("createSpellChecker with dictionary-pt", () => {
  let checker: SpellChecker;
  beforeAll(async () => { checker = await createSpellChecker(pt, ["Zotero"]); }, 30_000);
  afterAll(() => { checker.dispose(); });

  it("checks and suggests", () => {
    expect(checker.check("não")).toBe(true);
    expect(checker.check("nao")).toBe(false);
    expect(checker.suggest("nao")).toContain("não");
    expect(checker.suggest("nao", 1).length).toBeLessThanOrEqual(1);
  });

  it("accepts a title-case word at a sentence start", () => {
    expect(checker.check("Casa")).toBe(true);
  });

  it("accepts the user words and added words", () => {
    expect(checker.check("Zotero")).toBe(true);
    expect(checker.check("LabShelf")).toBe(false);
    checker.addWord("LabShelf");
    expect(checker.check("LabShelf")).toBe(true);
  });

  it("completes a prefix with stems and inflections", () => {
    const words = checker.complete("comput", 200);
    expect(words).toContain("computador");
    expect(words).toContain("computadores");
    expect(words.every((word) => word.startsWith("comput"))).toBe(true);
    expect(new Set(words).size).toBe(words.length);
    expect(words.every((word) => checker.check(word))).toBe(true);
  });

  it("ranks base words before the other inflections", () => {
    expect(checker.complete("comput").slice(0, 8)).toContain("computador");
    expect(checker.complete("inform").slice(0, 8)).toContain("informação");
    const words = checker.complete("comput", 200);
    // A stem before its conjugations, and the verb's conjugations shortest first.
    expect(words.indexOf("computar")).toBeLessThan(words.indexOf("computa"));
    expect(words.indexOf("computa")).toBeLessThan(words.indexOf("computamos"));
  });

  it("caps completions and ignores a one-letter prefix", () => {
    expect(checker.complete("comput").length).toBeLessThanOrEqual(20);
    expect(checker.complete("c")).toEqual([]);
    expect(checker.complete("")).toEqual([]);
  });
});

describe("createSpellChecker with dictionary-en", () => {
  let checker: SpellChecker;
  beforeAll(async () => { checker = await createSpellChecker(en, []); }, 30_000);
  afterAll(() => { checker.dispose(); });

  it("suggests corrections", () => {
    expect(checker.check("the")).toBe(true);
    expect(checker.check("teh")).toBe(false);
    expect(checker.suggest("teh")).toContain("the");
  });

  it("normalises a typographic apostrophe", () => {
    expect(checker.check("don’t")).toBe(true);
  });

  it("ranks a common word among the first completions", () => {
    expect(checker.complete("comput").slice(0, 8)).toContain("computer");
  });
});

/*
 * The checker must start once a host bundles it as browser ESM, as the VS Code webviews and the browser extension do
 * (packages/vscode/build/webviews.mjs: format esm, platform browser, target chrome138). Jest loads hunspell-asm's
 * CommonJS build through Node, so only a real bundle shows a broken import (hunspell-asm's ESM build namespace-imports
 * its CommonJS runtime: "runtimeModule is not a function").
 */
// The bundle runs as in a webview page: window, self and document exist, so emscripten takes its web path.
const RUNNER = `
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;
globalThis.document ??= { currentScript: null };
const [bundle, entry] = process.argv.slice(2);
const { createSpellChecker } = await import(bundle);
const folder = dirname(entry);
const files = { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
const checker = await createSpellChecker(files, []);
process.stdout.write(JSON.stringify({ the: checker.check("the"), teh: checker.check("teh") }));
checker.dispose();
`;

describe("spell checker bundled as browser ESM", () => {
  it("starts and checks English words", () => {
    // __dirname is <repo>/packages/core/__tests__/writing/proofing: five levels up is the repo root.
    const root = resolve(__dirname, "../../../../..");
    const esbuild = join(root, "node_modules", ".bin", "esbuild");
    const entry = join(root, "packages", "core", "src", "writing", "proofing", "checker.ts");
    const dir = mkdtempSync(join(tmpdir(), "labshelf-checker-bundle-"));
    try {
      const outfile = join(dir, "checker.mjs");
      const build = spawnSync(
        esbuild,
        [entry, "--bundle", "--format=esm", "--platform=browser", "--target=chrome138", "--log-level=warning", `--outfile=${outfile}`],
        { cwd: root, encoding: "utf8", timeout: 120000 },
      );
      expect(build.error).toBeUndefined();
      expect(build.status).toBe(0);
      expect(build.stderr).not.toContain("call-import-namespace");
      const runner = join(dir, "run.mjs");
      writeFileSync(runner, RUNNER);
      const run = spawnSync(process.execPath, [runner, outfile, require.resolve("dictionary-en")], { cwd: dir, encoding: "utf8", timeout: 120000 });
      expect(run.error).toBeUndefined();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({ the: true, teh: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("spell checker engine start", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock("hunspell-asm/dist/cjs/index.js");
  });

  // A page that refuses WebAssembly leaves hunspell-asm's loadModule pending for ever.
  it("rejects with a readable error when the engine never starts, and tries again on the next call", async () => {
    jest.useFakeTimers();
    const loadModule = jest.fn(() => new Promise<never>(() => undefined));
    let isolated: typeof import("../../../src/writing/proofing/checker.js") | undefined;
    jest.isolateModules(() => {
      jest.doMock("hunspell-asm/dist/cjs/index.js", () => ({ loadModule }));
      isolated = require("../../../src/writing/proofing/checker.js");
    });
    const files = { aff: new Uint8Array([1]), dic: new Uint8Array([1]) };
    const first = isolated!.createSpellChecker(files, []);
    const settled = jest.fn();
    first.catch(settled);
    await jest.advanceTimersByTimeAsync(14_000);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_500);
    await expect(first).rejects.toThrow("The spell checker engine could not start (WebAssembly blocked?)");

    const second = isolated!.createSpellChecker(files, []);
    second.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(16_000);
    await expect(second).rejects.toThrow("WebAssembly blocked?");
    expect(loadModule).toHaveBeenCalledTimes(2);
  });
});
