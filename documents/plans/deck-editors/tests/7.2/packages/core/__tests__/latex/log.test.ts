// Verifies that Overfull \vbox problems get their own kind, apart from the \hbox ones (D10 overflow badges).
import { parseTexLog } from "../../src/latex/index";

const head = "This is pdfTeX, Version 3.141592653-2.6-1.40.29 (TeX Live 2026)\n entering extended mode\n file:line:error style messages enabled.\n**talk.tex\n(./talk.tex\n";
const log = (...body: string[]): string => `${head}${body.join("\n")}\n)\nOutput written on talk.pdf (2 pages, 1000 bytes).\n`;

describe("parseTexLog Overfull boxes", () => {
  it("7.2a gives an Overfull \\vbox the kind overfullPage and the line it was detected at", () => {
    const problems = parseTexLog(log("", "Overfull \\vbox (12.3pt too high) detected at line 42", "[]", "", "[1]"), "pdflatex");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "overfullPage", line: 42, file: "talk.tex", severity: "info" });
  });

  it("7.2a keeps the message of an Overfull \\vbox", () => {
    const problems = parseTexLog(log("", "Overfull \\vbox (12.3pt too high) detected at line 42", "[]", ""), "pdflatex");
    expect(problems[0]?.message).toBe("Content is 12.3pt too tall for the page.");
  });

  it("7.2a keeps the kind overfull for an Overfull \\hbox", () => {
    const problems = parseTexLog(log("", "Overfull \\hbox (109.55663pt too wide) in paragraph at lines 3--4", "[] ", " []", ""), "pdflatex");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "overfull", line: 3, file: "talk.tex", severity: "info", message: "A line sticks 109.6pt into the margin." });
  });

  it("7.2a tells a \\vbox and an \\hbox of the same log apart", () => {
    const problems = parseTexLog(log("", "Overfull \\hbox (10.0pt too wide) in paragraph at lines 3--4", "[] ", "", "Overfull \\vbox (12.3pt too high) detected at line 42", "[]", ""), "pdflatex");
    expect(problems.map((p) => [p.kind, p.line])).toEqual([["overfull", 3], ["overfullPage", 42]]);
  });

  it("7.2a takes the file of an Overfull \\vbox from the file stack", () => {
    const text = `${head}(./part.tex\n\nOverfull \\vbox (5.0pt too high) detected at line 7\n[]\n\n)\n)\nOutput written on talk.pdf (1 page, 1000 bytes).\n`;
    expect(parseTexLog(text, "pdflatex")[0]).toMatchObject({ kind: "overfullPage", line: 7, file: "part.tex" });
  });
});
