/** Contract of finding a paper's main TeX file and flattening its \input, \include and \subfile tree into one text. */
import { findMainFile, flattenSource } from "../../src/equations/flatten.js";

const files = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));
const DOC = "\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}\n";

describe("findMainFile", () => {
  it("1.1c picks the only file with both \\documentclass and \\begin{document}", () => {
    const set = files({ "sections/intro.tex": "Intro text", "paper/root.tex": DOC, "macros.sty": "\\newcommand{\\x}{y}" });
    expect(findMainFile(set)).toBe("paper/root.tex");
  });

  it("1.1c ignores a file that has \\documentclass but no \\begin{document}", () => {
    const set = files({ "preamble.tex": "\\documentclass{article}\n", "body.tex": DOC });
    expect(findMainFile(set)).toBe("body.tex");
  });

  it("1.1c prefers a file named like ms, main or paper among several complete documents", () => {
    const set = files({ "zzz.tex": `${DOC}${"filler\n".repeat(200)}`, "main.tex": DOC, "aaa.tex": DOC });
    expect(findMainFile(set)).toBe("main.tex");
  });

  it("1.1c takes the largest complete document when none is named like ms, main or paper", () => {
    const set = files({ "short.tex": DOC, "long.tex": `${DOC}${"filler\n".repeat(200)}`, "mid.tex": `${DOC}${"filler\n".repeat(20)}` });
    expect(findMainFile(set)).toBe("long.tex");
  });

  it("1.1c returns undefined when no file is a complete document", () => {
    expect(findMainFile(files({ "a.tex": "just text", "b.sty": "\\newcommand{\\x}{y}" }))).toBeUndefined();
  });
});

describe("flattenSource", () => {
  it("1.1c replaces \\input, \\include and \\subfile with the text of the file", () => {
    const set = files({ "main.tex": "A \\input{b} B \\include{c} C \\subfile{d} D", "b.tex": "[b]", "c.tex": "[c]", "d.tex": "[d]" });
    expect(flattenSource(set, "main.tex")).toBe("A [b] B [c] C [d] D");
  });

  it("1.1c resolves a name written with and without the .tex extension", () => {
    const set = files({ "main.tex": "\\input{plain}|\\input{ext.tex}", "plain.tex": "PLAIN", "ext.tex": "EXT" });
    expect(flattenSource(set, "main.tex")).toBe("PLAIN|EXT");
  });

  it("1.1c resolves nested inputs in subfolders relative to the folder of the main file", () => {
    const set = files({
      "paper/main.tex": "\\input{sections/a}",
      "paper/sections/a.tex": "A(\\input{sections/b.tex})",
      "paper/sections/b.tex": "B(\\include{deep/c})",
      "paper/deep/c.tex": "C",
    });
    expect(flattenSource(set, "paper/main.tex")).toBe("A(B(C))");
  });

  it("1.1c ignores a commented-out input and drops the comment", () => {
    const set = files({ "main.tex": "before\n% \\input{hidden}\nafter \\input{shown}\n", "hidden.tex": "HIDDEN", "shown.tex": "SHOWN" });
    const flat = flattenSource(set, "main.tex");
    expect(flat).not.toContain("HIDDEN");
    expect(flat).not.toContain("\\input{hidden}");
    expect(flat).toContain("SHOWN");
    expect(flat).toContain("before");
  });

  it("1.1c keeps an escaped percent sign as text", () => {
    const set = files({ "main.tex": "rate is 5\\% of \\input{b}", "b.tex": "all" });
    expect(flattenSource(set, "main.tex")).toBe("rate is 5\\% of all");
  });

  it("1.1c leaves the command as it is when the file is missing", () => {
    const set = files({ "main.tex": "x \\input{missing} y \\input{here}", "here.tex": "H" });
    expect(flattenSource(set, "main.tex")).toBe("x \\input{missing} y H");
  });

  it("1.1c stops a cycle at the second visit instead of looping", () => {
    const set = files({ "main.tex": "M \\input{a}", "a.tex": "AMARK \\input{b}", "b.tex": "BMARK \\input{a}" });
    const flat = flattenSource(set, "main.tex");
    expect(flat.split("AMARK")).toHaveLength(2);
    expect(flat.split("BMARK")).toHaveLength(2);
  });

  it("1.1c returns the main file's text when it includes nothing", () => {
    expect(flattenSource(files({ "main.tex": DOC, "other.tex": "unused" }), "main.tex")).toBe(DOC);
  });
});
