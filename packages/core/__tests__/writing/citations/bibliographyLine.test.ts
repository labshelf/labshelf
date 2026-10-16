/** Verifies that the main file loads the generated bibliography exactly once. */
import { withBibliographyLine } from "../../../src/writing/citations/index";

describe("withBibliographyLine in LaTeX", () => {
  it("inserts style and bibliography before \\end{document}", () => {
    const result = withBibliographyLine("latex", "\\begin{document}\nx\n\\end{document}\n", "labshelf.bib");
    expect(result).toEqual({
      kind: "added",
      text: "\\begin{document}\nx\n\\bibliographystyle{plain}\n\\bibliography{labshelf}\n\n\\end{document}\n",
    });
  });

  it("appends to an existing \\bibliography list", () => {
    const result = withBibliographyLine("latex", "\\bibliography{refs}\n", "labshelf.bib");
    expect(result).toEqual({ kind: "added", text: "\\bibliography{refs,labshelf}\n" });
  });

  it("adds an \\addbibresource after the last one when biblatex is used", () => {
    const text = "\\addbibresource{a.bib}\n\\addbibresource{b.bib}\n\\begin{document}";
    expect(withBibliographyLine("latex", text, "labshelf.bib").text)
      .toBe("\\addbibresource{a.bib}\n\\addbibresource{b.bib}\n\\addbibresource{labshelf.bib}\n\\begin{document}");
  });

  it.each(["\\bibliography{refs, labshelf}", "\\addbibresource{labshelf.bib}"])("leaves %s as it is", (text) => {
    expect(withBibliographyLine("latex", text, "labshelf.bib")).toEqual({ kind: "present", text });
  });

  it("does not mistake a file whose name only contains the bibliography's name", () => {
    expect(withBibliographyLine("latex", "\\bibliography{mylabshelf_old}", "labshelf.bib").kind).toBe("added");
  });
});

describe("withBibliographyLine in Typst", () => {
  it("appends the call at the end", () => {
    expect(withBibliographyLine("typst", "= Intro\n", "labshelf.bib"))
      .toEqual({ kind: "added", text: "= Intro\n\n#bibliography(\"labshelf.bib\")\n" });
  });

  it("is present when the call already names the file", () => {
    const text = "#bibliography((\"refs.bib\", \"labshelf.bib\"))";
    expect(withBibliographyLine("typst", text, "labshelf.bib").kind).toBe("present");
  });

  it("reports a conflict and keeps the text when another bibliography is loaded", () => {
    const text = "#bibliography(\"refs.bib\")\n";
    expect(withBibliographyLine("typst", text, "labshelf.bib")).toEqual({ kind: "conflict", text });
  });
});
