import { normalizeTitleForMatch } from "@labshelf/core";

describe("titleKey", () => {
  it("normalises accents, case and punctuation", () => {
    expect(normalizeTitleForMatch("  Análise: A Ótima  ")).toBe("analise a otima");
  });

  it("treats titles that differ only in punctuation as equal", () => {
    expect(normalizeTitleForMatch("Deep-Learning (2nd ed.)")).toBe(normalizeTitleForMatch("deep learning 2nd ed"));
  });
});
