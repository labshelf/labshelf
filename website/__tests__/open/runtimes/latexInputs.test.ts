// Pins the browser LaTeX engine's view of a project (main source, other files, BibTeX) and the diagnostics read from its log.
import { deriveBusytexCompile, deriveLatexDiagnostics } from "../../../src/open/runtimes/latexInputs";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("deriveBusytexCompile", () => {
  it("passes the main file as text and every other file as bytes, under their project paths", () => {
    const image = new Uint8Array([137, 80, 78, 71]);
    const compile = deriveBusytexCompile({
      format: "latex", main: "paper/main.tex",
      files: new Map([["paper/main.tex", bytes("\\documentclass{article}é")], ["paper/intro.tex", bytes("Hi")], ["paper/fig.png", image]]),
    });
    expect(compile.input).toBe("\\documentclass{article}é");
    expect(compile.mainTexPath).toBe("paper/main.tex");
    expect(compile.additionalFiles).toEqual([{ path: "paper/intro.tex", content: bytes("Hi") }, { path: "paper/fig.png", content: image }]);
    expect(compile.bibtex).toBe(false);
  });

  it("runs BibTeX when the project holds a .bib file", () => {
    const compile = deriveBusytexCompile({ format: "latex", main: "main.tex", files: new Map([["main.tex", bytes("x")], ["refs.BIB", bytes("@a{b,}")]]) });
    expect(compile.bibtex).toBe(true);
  });

  it("compiles an empty document when the main file is missing from the input", () => {
    expect(deriveBusytexCompile({ format: "latex", main: "main.tex", files: new Map() }).input).toBe("");
  });
});

describe("deriveLatexDiagnostics", () => {
  it("reads errors and warnings from the log, located in the source", () => {
    const log = [
      "(./main.tex",
      "./main.tex:5: Undefined control sequence.",
      "l.5 \\foo",
      "",
      "LaTeX Warning: Reference `sec:x' on page 1 undefined on input line 7.",
      ")",
    ].join("\n");
    const diagnostics = deriveLatexDiagnostics(log, true);
    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: expect.stringMatching(/^Unknown command \\foo\. /), file: "main.tex", line: 5 }));
    expect(diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  it("says a missing package or class is not available in the browser engine", () => {
    const log = [
      "(./main.tex",
      "! LaTeX Error: File `siunitx.sty' not found.",
      "",
      "! LaTeX Error: File `revtex4-2.cls' not found.",
      ")",
    ].join("\n");
    const messages = deriveLatexDiagnostics(log, false).map((d) => d.message);
    expect(messages).toContain("The LaTeX package siunitx.sty is not available in the browser engine.");
    expect(messages).toContain("The LaTeX package revtex4-2.cls is not available in the browser engine.");
    expect(messages.some((m) => m.includes("tlmgr") || m.includes("not installed"))).toBe(false);
  });

  it("answers one error when the run made no PDF and the log names no problem", () => {
    expect(deriveLatexDiagnostics("", false)).toEqual([{ severity: "error", message: "LaTeX stopped without a PDF and its log names no error." }]);
    expect(deriveLatexDiagnostics("", true)).toEqual([]);
  });
});
