import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSpellChecker } from "../../../src/writing/proofing/checker.js";
import type { SpellChecker } from "../../../src/writing/proofing/checker.js";
import type { DictionaryFiles } from "../../../src/writing/proofing/port.js";
import { stemIndex } from "../../../src/writing/proofing/stems.js";

function dictionaryFolder(pkg: string): string {
  const candidates = [join(process.cwd(), "node_modules", pkg), join(process.cwd(), "packages", "core", "node_modules", pkg)];
  const found = candidates.find((folder) => existsSync(join(folder, "index.aff")));
  if (!found) { throw new Error(`${pkg} is not installed`); }
  return found;
}

function readDictionary(pkg: string): DictionaryFiles {
  const folder = dictionaryFolder(pkg);
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const pt = readDictionary("dictionary-pt");
const en = readDictionary("dictionary-en");

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

  it("completes a prefix with stems and inflections, shortest first", () => {
    const words = checker.complete("comput", 200);
    expect(words).toContain("computador");
    expect(words).toContain("computadores");
    expect(words.every((word) => word.startsWith("comput"))).toBe(true);
    expect(new Set(words).size).toBe(words.length);
    for (let i = 1; i < words.length; i += 1) { expect(words[i - 1]?.length).toBeLessThanOrEqual(words[i]?.length ?? 0); }
    expect(words.every((word) => checker.check(word))).toBe(true);
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
});
