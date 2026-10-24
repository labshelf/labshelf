import { surname } from "@labshelf/core";

describe("surname", () => {
  it("takes the family name of 'Family, Given' even when initials follow", () => {
    expect(surname("Ibarra, Oscar H.")).toBe("ibarra");
  });

  it("folds accents and lower-cases", () => {
    expect(surname("José Álvarez")).toBe("alvarez");
    expect(surname("José Müller")).toBe("muller");
  });

  it("drops truncation marks", () => {
    expect(surname("P Shor…")).toBe("shor");
  });
});
