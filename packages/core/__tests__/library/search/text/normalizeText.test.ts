import { normalizeText } from "@labshelf/core";

describe("fold", () => {
  it("strips every kind of accent and lowercases", () => {
    expect(normalizeText("Çaglar ÉCOLE naïve")).toBe("caglar ecole naive");
    expect(normalizeText("Lässig")).toBe("lassig");
  });

  it("leaves unaccented text only lowercased", () => {
    expect(normalizeText("Attention")).toBe("attention");
  });
});
