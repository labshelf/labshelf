/** Verifies where citations sit in a source and how the backlink index groups them. */
import { addBacklinks, citationSites, sourceHeadings, type Backlink } from "../../../src/writing/backlinks/index";

describe("sourceHeadings", () => {
  it("reads LaTeX sections with their lines", () => {
    expect(sourceHeadings("latex", "intro\n\\section{Method}\n\\subsection*{Data  set}")).toEqual([
      { line: 1, title: "Method" }, { line: 2, title: "Data set" },
    ]);
  });

  it("reads Typst headings without their label", () => {
    expect(sourceHeadings("typst", "= Intro\ntext == not\n  == Related work <rel>\n=no space")).toEqual([
      { line: 0, title: "Intro" }, { line: 2, title: "Related work" },
    ]);
  });
});

describe("citationSites", () => {
  it("gives each LaTeX citation its line and the heading above it", () => {
    const text = "\\cite{a}\n\\section{Related}\nsee \\cite{b,c}\n\\section{Method \\cite{d}}";
    expect(citationSites("latex", text)).toEqual([
      { key: "a", line: 0, section: undefined },
      { key: "b", line: 2, section: "Related" },
      { key: "c", line: 2, section: "Related" },
      { key: "d", line: 3, section: "Method \\cite{d}" },
    ]);
  });

  it("places Typst references under their heading", () => {
    expect(citationSites("typst", "= Intro\n@a\n== Deep\n#cite(<b>)")).toEqual([
      { key: "a", line: 1, section: "Intro" },
      { key: "b", line: 3, section: "Deep" },
    ]);
  });

  it("ignores commented-out citations", () => {
    expect(citationSites("latex", "% \\cite{gone}\n\\cite{kept}")).toEqual([{ key: "kept", line: 1, section: undefined }]);
  });
});

describe("addBacklinks", () => {
  it("keeps one entry per project, file and section, at the first line", () => {
    const index = new Map<string, Backlink[]>();
    addBacklinks(index, "thesis", "ch1.tex", citationSites("latex", "\\section{A}\\cite{k}\n\\cite{k}\n\\section{B}\n\\cite{k}"));
    addBacklinks(index, "paper", "main.tex", citationSites("latex", "\\cite{k}"));
    expect(index.get("k")).toEqual([
      { project: "thesis", file: "ch1.tex", line: 0, section: "A" },
      { project: "thesis", file: "ch1.tex", line: 3, section: "B" },
      { project: "paper", file: "main.tex", line: 0, section: undefined },
    ]);
  });
});
