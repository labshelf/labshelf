import { fold } from "@labshelf/core";

describe("fold", () => {
  it("strips every kind of accent and lowercases", () => {
    expect(fold("Çaglar ÉCOLE naïve")).toBe("caglar ecole naive");
    expect(fold("Lässig")).toBe("lassig");
  });

  it("leaves unaccented text only lowercased", () => {
    expect(fold("Attention")).toBe("attention");
  });
});
