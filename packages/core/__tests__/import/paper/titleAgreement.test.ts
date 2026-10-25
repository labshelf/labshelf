import { deriveSurname } from "@labshelf/core";

describe("surname", () => {
  it("takes the family name of 'Family, Given' even when initials follow", () => {
    expect(deriveSurname("Ibarra, Oscar H.")).toBe("ibarra");
  });

  it("folds accents and lower-cases", () => {
    expect(deriveSurname("José Álvarez")).toBe("alvarez");
    expect(deriveSurname("José Müller")).toBe("muller");
  });

  it("drops truncation marks", () => {
    expect(deriveSurname("P Shor…")).toBe("shor");
  });
});
