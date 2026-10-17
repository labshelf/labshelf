// Tests the pandoc command line that converts a project's main file to Word, Markdown or HTML.
import { DOCUMENT_EXPORT_EXTENSIONS, pandocArgs } from "../../../../src/writing/project/export/index";

describe("pandocArgs", () => {
  it("reads LaTeX and writes Word", () => {
    expect(pandocArgs("latex", "main.tex", "docx", "/out/paper.docx"))
      .toEqual(["--from", "latex", "--to", "docx", "--output", "/out/paper.docx", "main.tex"]);
  });

  it("reads Typst and writes GitHub Markdown", () => {
    expect(pandocArgs("typst", "main.typ", "markdown", "/out/paper.md"))
      .toEqual(["--from", "typst", "--to", "gfm", "--output", "/out/paper.md", "main.typ"]);
  });

  it("writes HTML as a standalone page", () => {
    expect(pandocArgs("latex", "main.tex", "html", "/out/paper.html"))
      .toEqual(["--from", "latex", "--to", "html", "--standalone", "--output", "/out/paper.html", "main.tex"]);
  });

  it("names the file extension of each export", () => {
    expect(DOCUMENT_EXPORT_EXTENSIONS).toEqual({ docx: "docx", markdown: "md", html: "html" });
  });
});
