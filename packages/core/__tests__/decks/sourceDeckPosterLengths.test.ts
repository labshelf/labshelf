// Tests reading a source length (mm, cm, in, pt) to millimetres and writing millimetres back as a source length.
import { formatSourceLength, parseSourceLength } from "../../src/decks/sourceDeckPosterLengths.js";

describe("parseSourceLength", () => {
  it("10b.1d reads mm and cm lengths to millimetres", () => {
    expect(parseSourceLength("15mm")).toBe(15);
    expect(parseSourceLength("1.5cm")).toBe(15);
    expect(parseSourceLength("3cm")).toBe(30);
    expect(parseSourceLength("0mm")).toBe(0);
  });

  it("10b.1d reads in and pt lengths to millimetres rounded to 2 decimals", () => {
    expect(parseSourceLength("1in")).toBe(25.4);
    expect(parseSourceLength("72pt")).toBe(25.4);
    expect(parseSourceLength("1pt")).toBe(0.35);
    expect(parseSourceLength("10pt")).toBe(3.53);
  });

  it("10b.1d returns null for units it does not know and for things that are not lengths", () => {
    for (const value of ["2em", "1fr", "50%", "\\textwidth", "0.5\\textwidth", "", "abc", "15", "mm"]) expect(parseSourceLength(value)).toBeNull();
  });
});

describe("formatSourceLength", () => {
  it("10b.1d writes millimetres as mm without trailing zeros", () => {
    expect(formatSourceLength(15, "mm")).toBe("15mm");
    expect(formatSourceLength(10.5, "mm")).toBe("10.5mm");
    expect(formatSourceLength(0, "mm")).toBe("0mm");
  });

  it("10b.1d writes millimetres as cm without trailing zeros", () => {
    expect(formatSourceLength(15, "cm")).toBe("1.5cm");
    expect(formatSourceLength(30, "cm")).toBe("3cm");
    expect(formatSourceLength(25.4, "cm")).toBe("2.54cm");
  });

  it("10b.1d writes at most 2 decimals", () => {
    expect(formatSourceLength(12.3456, "mm")).toBe("12.35mm");
    expect(formatSourceLength(3.333, "mm")).toBe("3.33mm");
    expect(formatSourceLength(1.234, "cm")).toBe("0.12cm");
  });

  it("10b.1d writes what it reads back", () => {
    for (const mm of [0, 5, 12.5, 30, 841]) {
      expect(parseSourceLength(formatSourceLength(mm, "mm"))).toBe(mm);
      expect(parseSourceLength(formatSourceLength(mm, "cm"))).toBe(mm);
    }
  });
});
