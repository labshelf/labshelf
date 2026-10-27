import { normalizeAuthor, deriveFamilyName, formatAuthors, splitName } from "../../../src/library/record";

describe("familyName", () => {
  it("takes the surname of 'First Last' and of 'Last, First'", () => {
    expect(deriveFamilyName("Ada Lovelace")).toBe("Lovelace");
    expect(deriveFamilyName("Lovelace, Ada")).toBe("Lovelace");
    expect(deriveFamilyName("  Lovelace , Ada")).toBe("Lovelace");
  });

  it("splits on any whitespace, including tabs and non-breaking spaces", () => {
    expect(deriveFamilyName("Ada Lovelace")).toBe("Lovelace");
    expect(deriveFamilyName("Ada\tLovelace")).toBe("Lovelace");
    expect(deriveFamilyName("  Ada   Lovelace  ")).toBe("Lovelace");
  });

  it("returns a single-word name whole", () => {
    expect(deriveFamilyName("Plato")).toBe("Plato");
  });

  it("falls back to the trimmed full name when the surname is empty", () => {
    expect(deriveFamilyName(", Ada")).toBe(", Ada");
    expect(deriveFamilyName("  ")).toBe("");
  });
});

describe("formatAuthors", () => {
  it("is empty without authors", () => {
    expect(formatAuthors(undefined)).toBe("");
    expect(formatAuthors([])).toBe("");
  });

  it("shows the surname of one author", () => {
    expect(formatAuthors(["Ashish Vaswani"])).toBe("Vaswani");
  });

  it("joins two authors with an ampersand", () => {
    expect(formatAuthors(["Vaswani, Ashish", "Noam Shazeer"])).toBe("Vaswani & Shazeer");
  });

  it("shortens three or more authors to the first plus et al.", () => {
    expect(formatAuthors(["A One", "B Two", "C Three"])).toBe("One et al.");
    expect(formatAuthors(["A One", "B Two", "C Three", "D Four"])).toBe("One et al.");
  });

  it("drops blank entries before counting", () => {
    expect(formatAuthors(["", "A One", " ", "\t"])).toBe("One");
    expect(formatAuthors(["A One", " ", "B Two"])).toBe("One & Two");
    expect(formatAuthors(["", " "])).toBe("");
  });
});

describe("splitName and the particle rule", () => {
  it("keeps name particles with the family name", () => {
    expect(splitName("Ludwig van Beethoven")).toEqual({ given: "Ludwig", family: "van Beethoven" });
    expect(deriveFamilyName("Charles de la Vallée")).toBe("de la Vallée");
    expect(formatAuthors(["Ludwig van Beethoven", "Ada Lovelace"])).toBe("van Beethoven & Lovelace");
  });

  it("reads 'Family, Given' as written", () => {
    expect(splitName("van Beethoven, Ludwig")).toEqual({ given: "Ludwig", family: "van Beethoven" });
  });
});

describe("authorKey", () => {
  it("treats the full and the initialled form of one person alike", () => {
    expect(normalizeAuthor("Ashish Vaswani")).toBe(normalizeAuthor("Vaswani, A."));
    expect(normalizeAuthor("Ashish Vaswani")).not.toBe(normalizeAuthor("Noam Vaswani"));
  });
});
