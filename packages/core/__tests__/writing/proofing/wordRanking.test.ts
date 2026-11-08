import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrequencyList, rankCompletion, type FrequencyList } from "../../../src/writing/proofing/wordRanking.js";

const DATA = join(__dirname, "../../../src/writing/proofing/frequency");
const ptBr = parseFrequencyList(new Uint8Array(readFileSync(join(DATA, "pt_br_50k.txt"))));
const en = parseFrequencyList(readFileSync(join(DATA, "en_50k.txt"), "utf8"));
const any = (): boolean => true;

/** The words of `text` and the index of the last one, the word being typed. */
function typing(text: string): { words: string[]; at: number } {
  const words = text.split(/\s+/).filter(Boolean);
  return { words, at: words.length - 1 };
}

describe("parseFrequencyList", () => {
  it("sorts the words by code unit with their counts, lower-cased", () => {
    const list = parseFrequencyList("the 100\nApple 7\nbad line\nzoo 3\n\n");
    expect(list.words).toEqual(["apple", "the", "zoo"]);
    expect([...list.counts]).toEqual([7, 100, 3]);
  });

  it("reads the vendored lists", () => {
    expect(ptBr.words.length).toBeGreaterThan(40_000);
    expect(en.words.length).toBeGreaterThan(40_000);
  });
});

describe("rankCompletion", () => {
  it("completes a common word from the frequency list", () => {
    const best = rankCompletion("computa", typing("um computa"), { frequency: ptBr, accept: any });
    expect(["computador", "computação"]).toContain(best);
    expect(rankCompletion("becau", typing("it was becau"), { frequency: en, accept: any })).toBe("because");
  });

  it("only offers dictionary words the checker accepts", () => {
    const best = rankCompletion("computa", typing("um computa"), { frequency: ptBr, accept: (word) => word !== "computador" });
    expect(best).not.toBe("computador");
  });

  it("prefers a word used twice in the document over a more frequent one", () => {
    const doc = typing("o computabilizador e o computabilizador depois comput");
    expect(rankCompletion("comput", doc, { frequency: ptBr, accept: any })).toBe("computabilizador");
  });

  it("prefers the word that followed the previous word in the document", () => {
    const doc = typing("as redes neurais e as redes neurais profundas usam redes neu");
    expect(rankCompletion("neu", doc, { frequency: ptBr, accept: any })).toBe("neurais");
    // A word pair seen once still lifts an otherwise rare word.
    const once = typing("as redes neurotransmissoras aqui e redes neu");
    expect(rankCompletion("neu", once, { frequency: ptBr, accept: any })).toBe("neurotransmissoras");
  });

  it("leaves the word being typed out of the document's words", () => {
    expect(rankCompletion("zyxw", typing("zyxw"), { accept: any })).toBeNull();
  });

  it("ranks with the document alone when there is no frequency list", () => {
    expect(rankCompletion("quan", typing("quantum quantum here quan"), { accept: any })).toBe("quantum");
  });

  it("answers nothing for short prefixes, unknown prefixes or when no candidate is clearly ahead", () => {
    expect(rankCompletion("co", typing("co"), { frequency: ptBr, accept: any })).toBeNull();
    expect(rankCompletion("xqzv", typing("xqzv"), { frequency: ptBr, accept: any })).toBeNull();
    const tie: FrequencyList = parseFrequencyList("alpha 100\nalpine 100\n");
    expect(rankCompletion("alp", typing("alp"), { frequency: tie, accept: any })).toBeNull();
    const ahead: FrequencyList = parseFrequencyList("alpha 1000\nalpine 100\n");
    expect(rankCompletion("alp", typing("alp"), { frequency: ahead, accept: any })).toBe("alpha");
  });

  it("follows the typed case", () => {
    expect(rankCompletion("Becau", typing("Becau"), { frequency: en, accept: any })).toBe("Because");
    expect(rankCompletion("BECAU", typing("BECAU"), { frequency: en, accept: any })).toBe("BECAUSE");
  });

  it("completes a capitalised document word in the typed case", () => {
    expect(rankCompletion("qua", typing("Quantum and Quantum qua"), { accept: any })).toBe("quantum");
  });

  it("looks a prefix up quickly", () => {
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) rankCompletion("com", typing("um com"), { frequency: ptBr, accept: any });
    expect((performance.now() - started) / 200).toBeLessThan(5);
  });
});
