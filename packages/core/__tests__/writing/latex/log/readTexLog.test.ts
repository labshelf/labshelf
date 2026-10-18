/** Verifies the transcript reader on the shapes real logs take: wrapped lines, nested files, unknown messages. */
import { parseTexLog } from "../../../../src/writing/latex/index";

const wrapped = (text: string): string => text.match(/.{1,79}/g)!.join("\n");

describe("TeX log reading", () => {
  it("joins lines TeX broke at 79 characters", () => {
    const warning = "LaTeX Warning: Reference `a-very-long-label-name-that-goes-past-the-wrap-width' on page 1 undefined on input line 42.";
    const fixed = `(./main.tex\n${wrapped(warning)}\n`;
    expect(fixed.split("\n")[1]).toHaveLength(79);
    expect(parseTexLog(fixed, "pdflatex")[0]).toMatchObject({ file: "main.tex", line: 42 });
  });

  it("ignores parentheses that are not files and returns to the outer file after a nested one closes", () => {
    const log = ["(./main.tex (HO) (./chapters/a.tex", ")", "! Undefined control sequence.", "l.9 \\oops", ""].join("\n");
    expect(parseTexLog(log, "xelatex")[0]).toMatchObject({ file: "main.tex", line: 9, message: "Unknown command \\oops." });
  });

  it("does not let parentheses inside an overfull box's text move the file stack", () => {
    const log = ["(./main.tex", "Overfull \\hbox (1.0pt too wide) in paragraph at lines 3--4", "[]\\OT1/cmr/m/n/10 text (open", "", "! Undefined control sequence.", "l.6 \\x", ""].join("\n");
    expect(parseTexLog(log, "xelatex").map((p) => p.file)).toEqual(["main.tex", "main.tex"]);
  });

  it("keeps TeX's words for an error it has no explanation for", () => {
    const log = ["(./main.tex", "! Package babel Error: Unknown option `klingon'.", "(babel)                The possible reason is a typo.", "l.4 \\begin{document}", ""].join("\n");
    expect(parseTexLog(log, "pdflatex")).toEqual([{
      severity: "error", message: "Package babel: Unknown option `klingon'. The possible reason is a typo.", file: "main.tex", line: 4,
    }]);
  });

  it("tells a pdfLaTeX user that \\directlua needs LuaLaTeX", () => {
    const log = ["(main.tex", "! Undefined control sequence.", "l.5 \\directlua", "              {tex.print(1)}", ""].join("\n");
    expect(parseTexLog(log, "pdflatex")[0]!.hint).toBe("\\directlua needs LuaLaTeX. Switch the compiler to LuaLaTeX.");
  });

  it("keeps the emergency stop when it is the only error", () => {
    expect(parseTexLog("./main.tex:3: Emergency stop.\n", "pdflatex")).toEqual([
      { severity: "error", message: "Emergency stop.", file: "main.tex", line: 3 },
    ]);
  });
});
