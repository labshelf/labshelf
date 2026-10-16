/** Verifies the check that a template's engine and Typst version are available on this machine. */
import { engineProblem } from "../../../src/writing/templates/index.js";
import type { TemplateEntry } from "../../../src/writing/templates/index.js";

function entry(over: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: "t", name: "T", description: "d", category: "article", format: "latex", engine: "pdflatex",
    main: "main.tex", license: "MIT", authors: ["A"], source: "community", ...over,
  };
}

const available = (engines: string[], typstVersion = "0.13.1") =>
  ({ engines: new Set(engines), typstVersion }) as Parameters<typeof engineProblem>[1];

describe("engineProblem", () => {
  it("is undefined when the engine is available", () => {
    expect(engineProblem(entry(), available(["pdflatex"]))).toBeUndefined();
  });

  it("names the missing engine", () => {
    expect(engineProblem(entry(), available(["xelatex", "typst"]))).toContain("pdflatex");
  });

  it("names a missing engine other than the first", () => {
    expect(engineProblem(entry({ engine: "lualatex" }), available(["pdflatex"]))).toContain("lualatex");
  });

  const typst = (compiler?: string) => entry({ format: "typst", engine: "typst", main: "main.typ", ...(compiler === undefined ? {} : { compiler }) });

  it("names both versions when the template needs a newer Typst", () => {
    const message = engineProblem(typst("0.14.0"), available(["typst"], "0.13.1"));
    expect(message).toContain("0.14.0");
    expect(message).toContain("0.13.1");
  });

  it("compares versions as numbers, not text", () => {
    expect(engineProblem(typst("0.13.10"), available(["typst"], "0.13.9"))).toContain("0.13.10");
    expect(engineProblem(typst("0.9.0"), available(["typst"], "0.13.1"))).toBeUndefined();
  });

  it("is undefined for an equal or older compiler, or none", () => {
    expect(engineProblem(typst("0.13.1"), available(["typst"], "0.13.1"))).toBeUndefined();
    expect(engineProblem(typst("0.11.0"), available(["typst"], "0.13.1"))).toBeUndefined();
    expect(engineProblem(typst(), available(["typst"], "0.13.1"))).toBeUndefined();
  });

  it("reports a missing typst engine", () => {
    expect(engineProblem(typst("0.11.0"), available(["pdflatex"]))).toContain("typst");
  });
});
