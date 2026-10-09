/** Contract of the same-work check that gates copies suggested by aggregators. */

import { sameWork, wordBigramDice } from "@labshelf/core";

describe("sameWork", () => {
  it("accepts equal titles after normalisation, whatever the case or punctuation", () => {
    expect(sameWork({ title: "Attention Is All You Need" }, { title: "attention is all you need." })).toBe(true);
  });

  it("accepts genuine variants of one title", () => {
    expect(sameWork(
      { title: "U-Net: Convolutional Networks for Biomedical Image Segmentation" },
      { title: "U Net Convolutional Networks for Biomedical Image Segmentation" },
    )).toBe(true);
  });

  it("splits near neighbours such as BWA and BWA-SW", () => {
    expect(sameWork(
      { title: "Fast and accurate short read alignment with Burrows-Wheeler transform" },
      { title: "Fast and accurate long-read alignment with Burrows-Wheeler transform" },
    )).toBe(false);
  });

  it("is false when either side has no title", () => {
    expect(sameWork({ year: 2020 }, { title: "A paper" })).toBe(false);
    expect(sameWork({ title: "A paper" }, { title: "" })).toBe(false);
  });

  it("allows one year of drift by default and the slack asked for", () => {
    const a = { title: "Deep residual learning for image recognition", year: 2015 };
    expect(sameWork(a, { ...a, year: 2016 })).toBe(true);
    expect(sameWork(a, { ...a, year: 2017 })).toBe(false);
    expect(sameWork(a, { ...a, year: 2017 }, { yearSlack: 2 })).toBe(true);
  });

  it("needs a shared surname when both sides list authors", () => {
    const title = "Deep residual learning for image recognition";
    expect(sameWork({ title, authors: ["Kaiming He", "Xiangyu Zhang"] }, { title, authors: ["He, Kaiming"] })).toBe(true);
    expect(sameWork({ title, authors: ["Kaiming He"] }, { title, authors: ["Jane Doe"] })).toBe(false);
  });

  it("ignores authors when one side lists none", () => {
    const title = "Deep residual learning for image recognition";
    expect(sameWork({ title, authors: ["Kaiming He"] }, { title })).toBe(true);
  });
});

describe("wordBigramDice", () => {
  it("is 1 for equal titles and 0 for disjoint ones", () => {
    expect(wordBigramDice("a b c", "a b c")).toBe(1);
    expect(wordBigramDice("a b c", "x y z")).toBe(0);
  });

  it("compares single-word titles by the word", () => {
    expect(wordBigramDice("bert", "bert")).toBe(1);
    expect(wordBigramDice("bert", "gpt")).toBe(0);
  });

  it("counts repeated pairs once per occurrence", () => {
    expect(wordBigramDice("a b a b", "a b")).toBeCloseTo((2 * 1) / (3 + 1));
  });
});
