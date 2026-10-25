import { formatVenueLine } from "../../../src/library/paper/index";

describe("formatProjectVenueLine", () => {
  it("joins venue, year, volume(issue) and pages", () => {
    expect(formatVenueLine({ journal: "Nature", year: 2017, volume: "12", issue: "3", pages: "45–67" }))
      .toBe("Nature · 2017 · 12(3) · pp. 45–67");
  });

  it("shows the volume alone and drops an issue that has no volume", () => {
    expect(formatVenueLine({ journal: "Nature", volume: "12" })).toBe("Nature · 12");
    expect(formatVenueLine({ journal: "Nature", issue: "3" })).toBe("Nature");
  });

  it("falls back to the publisher and prefers the journal", () => {
    expect(formatVenueLine({ publisher: "MIT Press", year: 2016 })).toBe("MIT Press · 2016");
    expect(formatVenueLine({ journal: "Nature", publisher: "Springer" })).toBe("Nature");
  });

  it("skips missing parts and is empty when nothing is known", () => {
    expect(formatVenueLine({ year: 2017 })).toBe("2017");
    expect(formatVenueLine({})).toBe("");
  });
});
