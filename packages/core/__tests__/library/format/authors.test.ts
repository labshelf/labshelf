import { familyName, formatAuthors } from "../../../src/library/format/index";

describe("familyName", () => {
  it("takes the surname of 'First Last' and of 'Last, First'", () => {
    expect(familyName("Ada Lovelace")).toBe("Lovelace");
    expect(familyName("Lovelace, Ada")).toBe("Lovelace");
    expect(familyName("  Lovelace , Ada")).toBe("Lovelace");
  });

  it("splits on any whitespace, including tabs and non-breaking spaces", () => {
    expect(familyName("Ada Lovelace")).toBe("Lovelace");
    expect(familyName("Ada\tLovelace")).toBe("Lovelace");
    expect(familyName("  Ada   Lovelace  ")).toBe("Lovelace");
  });

  it("returns a single-word name whole", () => {
    expect(familyName("Plato")).toBe("Plato");
  });

  it("falls back to the trimmed full name when the surname is empty", () => {
    expect(familyName(", Ada")).toBe(", Ada");
    expect(familyName("  ")).toBe("");
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
