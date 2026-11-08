import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createSpellChecker, type SpellChecker } from "../../../src/writing/proofing/checker.js";
import { parseFrequencyList } from "../../../src/writing/proofing/wordRanking.js";
import { stemIndex } from "../../../src/writing/proofing/stems.js";
import { accentMatch, acceptsWord, foldAccents, rankCorrections, wordDistance, type CorrectionSources } from "../../../src/writing/proofing/spelling.js";
import type { DictionaryFiles } from "../../../src/writing/proofing/port.js";

function readDictionary(entry: string): DictionaryFiles {
  const folder = dirname(entry);
  return { aff: new Uint8Array(readFileSync(join(folder, "index.aff"))), dic: new Uint8Array(readFileSync(join(folder, "index.dic"))) };
}

const FREQUENCY = join(__dirname, "../../../src/writing/proofing/frequency");
const pt = readDictionary(require.resolve("dictionary-pt"));
const ptFrequency = parseFrequencyList(new Uint8Array(readFileSync(join(FREQUENCY, "pt_br_50k.txt"))));

describe("accent folding and distance", () => {
  it("folds accents, cedilla and case", () => {
    expect(foldAccents("Seções")).toBe("secoes");
    expect(foldAccents("informação")).toBe("informacao");
    expect(foldAccents("plain")).toBe("plain");
  });

  it("counts an adjacent swap as one edit", () => {
    expect(wordDistance("teh", "the")).toBe(1);
    expect(wordDistance("secoes", "secies")).toBe(1);
    expect(wordDistance("abc", "abc")).toBe(0);
  });
});

describe("acceptsWord", () => {
  const list = parseFrequencyList("papers 100\nnao 50\nnão 5000\nab 900\n");
  const none = (): boolean => false;

  it("accepts common list words of three letters or more, inner capitals and secondary words", () => {
    expect(acceptsWord("papers", { check: none, frequency: list })).toBe(true);
    expect(acceptsWord("Papers", { check: none, frequency: list })).toBe(true);
    expect(acceptsWord("ab", { check: none, frequency: list })).toBe(false);
    expect(acceptsWord("LabShelf", { check: none })).toBe(true);
    expect(acceptsWord("TikZ", { check: none })).toBe(true);
    expect(acceptsWord("exemplu", { check: none, frequency: list })).toBe(false);
    expect(acceptsWord("teh", { check: none, secondary: (word) => word === "teh" })).toBe(true);
  });

  it("does not accept a list word whose accented spelling is more frequent", () => {
    expect(acceptsWord("nao", { check: none, frequency: list, accentMatch: () => "não" })).toBe(false);
  });
});

describe("rankCorrections with dictionary-pt and the pt-BR frequency list", () => {
  let checker: SpellChecker;
  let sources: CorrectionSources;
  beforeAll(async () => {
    checker = await createSpellChecker(pt, []);
    sources = { frequency: ptFrequency, stems: stemIndex(pt.dic).stems };
  }, 30_000);
  afterAll(() => { checker.dispose(); });

  it("puts the accented word first and keeps the typed case", () => {
    expect(rankCorrections(checker, "secoes", sources)[0]).toBe("seções");
    expect(rankCorrections(checker, "informacao", sources)[0]).toBe("informação");
    expect(rankCorrections(checker, "nao", sources)[0]).toBe("não");
    expect(rankCorrections(checker, "Secoes", sources)[0]).toBe("Seções");
    expect(accentMatch(checker, "nao", sources)).toBe("não");
  });

  it("never offers an affix form nobody writes", () => {
    expect(rankCorrections(checker, "secoes", sources)).not.toContain("secies");
    // dictionary-pt accepts "secies" (an affix form) and Hunspell suggests it first; it is in neither list.
    expect(checker.check("secies")).toBe(true);
    expect(rankCorrections(checker, "Secoes", sources)).not.toContain("Secies");
  });

  it("ranks Hunspell's real words by distance", () => {
    const found = rankCorrections(checker, "exemplu", sources);
    expect(found[0]).toBe("exemplo");
  });
});
