// Tests that bold and italic wrap, toggle and place the cursor per source language.
import { wrapSelection } from "../../../src/writing/snippet/index";

describe("wrapSelection", () => {
  it.each([
    ["latex", "bold", "\\textbf{word}"],
    ["latex", "italic", "\\emph{word}"],
    ["typst", "bold", "*word*"],
    ["typst", "italic", "_word_"],
  ] as const)("wraps a selection in %s %s", (language, style, expected) => {
    expect(wrapSelection(language, style, "word")).toEqual({ text: expected });
  });

  it("inserts empty markers and puts the cursor between them", () => {
    expect(wrapSelection("latex", "bold", "")).toEqual({ text: "\\textbf{}", cursor: 8 });
    expect(wrapSelection("typst", "italic", "")).toEqual({ text: "__", cursor: 1 });
  });

  it("unwraps a selection that is exactly wrapped", () => {
    expect(wrapSelection("latex", "italic", "\\emph{a b}")).toEqual({ text: "a b" });
    expect(wrapSelection("typst", "bold", "*a b*")).toEqual({ text: "a b" });
  });

  it("wraps only the selection when it sits inside other markup", () => {
    expect(wrapSelection("latex", "bold", "a b")).toEqual({ text: "\\textbf{a b}" });
  });

  it("wraps text that merely starts and ends with the markers of separate spans", () => {
    expect(wrapSelection("latex", "bold", "\\textbf{a} and \\textbf{b}"))
      .toEqual({ text: "\\textbf{\\textbf{a} and \\textbf{b}}" });
    expect(wrapSelection("typst", "bold", "*a* and *b*")).toEqual({ text: "**a* and *b**" });
  });

  it("wraps a different style instead of unwrapping it", () => {
    expect(wrapSelection("latex", "bold", "\\emph{a}")).toEqual({ text: "\\textbf{\\emph{a}}" });
  });
});
