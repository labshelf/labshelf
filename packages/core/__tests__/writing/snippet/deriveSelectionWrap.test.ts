// Tests that bold and italic wrap, toggle and place the cursor per source language.
import { deriveSelectionWrap } from "../../../src/writing/snippet/index";

describe("deriveSelectionWrap", () => {
  it.each([
    ["latex", "bold", "\\textbf{word}"],
    ["latex", "italic", "\\emph{word}"],
    ["typst", "bold", "*word*"],
    ["typst", "italic", "_word_"],
  ] as const)("wraps a selection in %s %s", (language, style, expected) => {
    expect(deriveSelectionWrap(language, style, "word")).toEqual({ text: expected });
  });

  it("inserts empty markers and puts the cursor between them", () => {
    expect(deriveSelectionWrap("latex", "bold", "")).toEqual({ text: "\\textbf{}", cursor: 8 });
    expect(deriveSelectionWrap("typst", "italic", "")).toEqual({ text: "__", cursor: 1 });
  });

  it("unwraps a selection that is exactly wrapped", () => {
    expect(deriveSelectionWrap("latex", "italic", "\\emph{a b}")).toEqual({ text: "a b" });
    expect(deriveSelectionWrap("typst", "bold", "*a b*")).toEqual({ text: "a b" });
  });

  it("wraps only the selection when it sits inside other markup", () => {
    expect(deriveSelectionWrap("latex", "bold", "a b")).toEqual({ text: "\\textbf{a b}" });
  });

  it("wraps text that merely starts and ends with the markers of separate spans", () => {
    expect(deriveSelectionWrap("latex", "bold", "\\textbf{a} and \\textbf{b}"))
      .toEqual({ text: "\\textbf{\\textbf{a} and \\textbf{b}}" });
    expect(deriveSelectionWrap("typst", "bold", "*a* and *b*")).toEqual({ text: "**a* and *b**" });
  });

  it("wraps a different style instead of unwrapping it", () => {
    expect(deriveSelectionWrap("latex", "bold", "\\emph{a}")).toEqual({ text: "\\textbf{\\emph{a}}" });
  });
});
