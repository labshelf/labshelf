/** Verifies the gallery sort orders over template entries. */
import { orderTemplates, type TemplateEntry } from "../../src/templates/index";

function entry(over: Partial<TemplateEntry> & { id: string }): TemplateEntry {
  return {
    name: over.id, description: "A template.", category: "article", format: "latex", engine: "pdflatex",
    main: "main.tex", license: "MIT", authors: ["Jane Doe"], source: "community", ...over,
  };
}
const ids = (list: readonly TemplateEntry[]) => list.map((e) => e.id);

describe("orderTemplates most-used", () => {
  it("orders by downloads descending and puts entries without a count last", () => {
    const list = [entry({ id: "none-a" }), entry({ id: "low", downloads: 3 }), entry({ id: "high", downloads: 90 }), entry({ id: "zero", downloads: 0 }), entry({ id: "none-b" })];
    expect(ids(orderTemplates(list, "most-used"))).toEqual(["high", "low", "zero", "none-a", "none-b"]);
  });

  it("keeps the original order on ties", () => {
    const list = [entry({ id: "b", downloads: 5 }), entry({ id: "a", downloads: 5 }), entry({ id: "c", downloads: 5 })];
    expect(ids(orderTemplates(list, "most-used"))).toEqual(["b", "a", "c"]);
  });

  it("returns a new array and leaves the input alone", () => {
    const list = [entry({ id: "a", downloads: 1 }), entry({ id: "b", downloads: 2 })];
    const sorted = orderTemplates(list, "most-used");
    expect(sorted).not.toBe(list);
    expect(ids(list)).toEqual(["a", "b"]);
  });
});

describe("orderTemplates name", () => {
  it("orders by name ignoring case and accents", () => {
    const list = [entry({ id: "1", name: "thesis" }), entry({ id: "2", name: "Álgebra" }), entry({ id: "3", name: "Poster" })];
    expect(ids(orderTemplates(list, "name"))).toEqual(["2", "3", "1"]);
  });

  it("keeps the original order when names compare equal", () => {
    const list = [entry({ id: "x", name: "Paper" }), entry({ id: "y", name: "paper" }), entry({ id: "z", name: "PAPER" })];
    expect(ids(orderTemplates(list, "name"))).toEqual(["x", "y", "z"]);
  });
});
