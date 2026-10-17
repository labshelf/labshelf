/** Verifies the use count shown on gallery cards and the detail page. */
import { templateUsesCount, templateUsesLabel, type TemplateEntry } from "../../../src/writing/templates/index";

const entry = (downloads?: number): TemplateEntry => ({
  id: "t", name: "T", description: "A template.", category: "article", format: "latex", engine: "pdflatex",
  main: "main.tex", license: "MIT", authors: ["Jane Doe"], source: "community", ...(downloads === undefined ? {} : { downloads }),
});

describe("templateUsesLabel", () => {
  it("is undefined without a count", () => {
    expect(templateUsesLabel(entry())).toBeUndefined();
    expect(templateUsesCount(entry())).toBeUndefined();
  });

  it.each([
    [0, "0 uses"], [1, "1 use"], [2, "2 uses"], [950, "950 uses"], [999, "999 uses"],
    [1000, "1k uses"], [1200, "1.2k uses"], [12000, "12k uses"], [1250, "1.3k uses"],
    [1_500_000, "1.5M uses"], [2_000_000, "2M uses"],
  ])("formats %i as %s", (downloads, label) => {
    expect(templateUsesLabel(entry(downloads))).toBe(label);
  });

  it("gives the detail row the count without the word", () => {
    expect(templateUsesCount(entry(1200))).toBe("1.2k");
    expect(templateUsesCount(entry(1))).toBe("1");
  });
});
