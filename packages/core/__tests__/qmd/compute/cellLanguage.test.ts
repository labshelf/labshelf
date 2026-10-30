import type { CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import * as cellLanguage from "../../../src/qmd/compute/cellLanguage";

const { cellLanguageLabel, toCellLanguage } = cellLanguage;
// CELL_LANGUAGES is reached through the namespace so the file compiles before the constant exists.
const languages = (): readonly CellLanguage[] => (cellLanguage as unknown as { CELL_LANGUAGES: readonly CellLanguage[] }).CELL_LANGUAGES;

describe("cellLanguage", () => {
  it("1.2c maps python and Python to python", () => {
    expect(toCellLanguage("python")).toBe("python");
    expect(toCellLanguage("Python")).toBe("python");
  });

  it("1.2c maps mathematica to mathematica", () => {
    expect(toCellLanguage("mathematica")).toBe("mathematica");
  });

  it("1.2c maps wolfram and wl to mathematica, case-insensitively", () => {
    expect(toCellLanguage("wolfram")).toBe("mathematica");
    expect(toCellLanguage("Wolfram")).toBe("mathematica");
    expect(toCellLanguage("wl")).toBe("mathematica");
    expect(toCellLanguage("WL")).toBe("mathematica");
  });

  it("1.2c maps r and R to r", () => {
    expect(toCellLanguage("r")).toBe("r");
    expect(toCellLanguage("R")).toBe("r");
  });

  it("1.2c rejects julia", () => {
    expect(toCellLanguage("julia")).toBeUndefined();
  });

  it("1.2c rejects an empty, null or undefined language", () => {
    expect(toCellLanguage("")).toBeUndefined();
    expect(toCellLanguage(null)).toBeUndefined();
    expect(toCellLanguage(undefined)).toBeUndefined();
  });

  it("A1 lists the three cell languages and every one maps to itself", () => {
    const all = ["python", "mathematica", "r"].map((name) => toCellLanguage(name));
    expect(all).toEqual(["python", "mathematica", "r"]);
    expect([...languages()].sort()).toEqual(["mathematica", "python", "r"]);
    for (const language of languages()) { expect(toCellLanguage(language)).toBe(language); }
  });

  it("A1 gives every language a distinct non-empty label", () => {
    const labels = (["python", "mathematica", "r"] as const).map((language) => cellLanguageLabel(language));
    for (const label of labels) { expect(label.length).toBeGreaterThan(0); }
    expect(new Set(labels).size).toBe(3);
  });
});
