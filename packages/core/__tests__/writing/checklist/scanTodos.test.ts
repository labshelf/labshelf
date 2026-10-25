/** Verifies the TODO scanner for LaTeX and Typst sources. */
import { scanTodos } from "../../../src/writing/checklist/index";

describe("scanTodos latex", () => {
  it("finds \\todo commands, with and without options", () => {
    const text = "Intro\n\\todo{fix x}\nmore \\todo[inline]{cite y} text";
    expect(scanTodos("latex", "main.tex", text)).toEqual([
      { file: "main.tex", line: 1, text: "fix x" },
      { file: "main.tex", line: 2, text: "cite y" },
    ]);
  });

  it("finds TODO and FIXME comments, trimmed", () => {
    const text = "a\n% TODO   write this \n% FIXME broken";
    expect(scanTodos("latex", "a.tex", text)).toEqual([
      { file: "a.tex", line: 1, text: "write this" },
      { file: "a.tex", line: 2, text: "broken" },
    ]);
  });

  it("finds a marker comment that follows code", () => {
    expect(scanTodos("latex", "a.tex", "Some text. % TODO later")).toEqual([{ file: "a.tex", line: 0, text: "later" }]);
  });

  it("does not treat an escaped percent as a comment", () => {
    expect(scanTodos("latex", "a.tex", "50\\% TODO not a comment")).toEqual([]);
  });

  it("is case-sensitive", () => {
    expect(scanTodos("latex", "a.tex", "% todo x\n% Fixme y")).toEqual([]);
  });

  it("keeps an empty text", () => {
    expect(scanTodos("latex", "a.tex", "% TODO")).toEqual([{ file: "a.tex", line: 0, text: "" }]);
  });

  it("returns nothing for empty input", () => {
    expect(scanTodos("latex", "a.tex", "")).toEqual([]);
  });
});

describe("scanTodos typst", () => {
  it("finds TODO and FIXME comments", () => {
    const text = "= Intro\n// TODO write\ntext // FIXME fix";
    expect(scanTodos("typst", "main.typ", text)).toEqual([
      { file: "main.typ", line: 1, text: "write" },
      { file: "main.typ", line: 2, text: "fix" },
    ]);
  });

  it("ignores lowercase markers and LaTeX syntax", () => {
    expect(scanTodos("typst", "main.typ", "// todo x\n% TODO y\n\\todo{z}")).toEqual([]);
  });
});
