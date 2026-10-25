/** Verifies the generated labshelf.bib text. */
import type { PaperRecord } from "../../../src/model/index";
import { BIBLIOGRAPHY_HEADER, createBibliography } from "../../../src/writing/citations/index";

function paper(id: string, citeKey = id): PaperRecord {
  return { id, citeKey, title: `Title ${id}`, path: `/lib/papers/${id}`, status: "unread", authors: ["Ada Lovelace"], year: 2020 };
}

describe("createBibliography", () => {
  it("writes the header and the cited entries in key order, without file paths", () => {
    const result = createBibliography(["b", "a"], [paper("a"), paper("b"), paper("c")]);
    expect(result.text.startsWith(`${BIBLIOGRAPHY_HEADER}\n\n@article{a,`)).toBe(true);
    expect(result.text.indexOf("@article{a,")).toBeLessThan(result.text.indexOf("@article{b,"));
    expect(result.text).not.toContain("@article{c,");
    expect(result.text).not.toContain("file =");
    expect(result.text.endsWith("}\n")).toBe(true);
    expect(result.resolved).toEqual(["a", "b"]);
  });

  it("gives the same bytes for the same citations in any order", () => {
    const papers = [paper("a"), paper("b")];
    expect(createBibliography(["a", "b", "a"], papers).text).toBe(createBibliography(["b", "a"], [...papers].reverse()).text);
  });

  it("reports keys no library paper has and matches keys case-sensitively", () => {
    const result = createBibliography(["A", "fig:intro"], [paper("a")]);
    expect(result).toEqual({ text: `${BIBLIOGRAPHY_HEADER}\n`, resolved: [], missing: ["A", "fig:intro"] });
  });

  it("uses the paper with the smallest id when two papers share a cite key", () => {
    const result = createBibliography(["k"], [paper("zeta", "k"), paper("alpha", "k")]);
    expect(result.text).toContain("Title alpha");
    expect(result.text).not.toContain("Title zeta");
  });
});
