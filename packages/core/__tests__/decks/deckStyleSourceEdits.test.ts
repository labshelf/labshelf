// Tests the Style block of LaTeX and Typst decks: reading it back (hand edits included), the refusals and the compiled decks.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { DEFAULT_DECK_STYLE, deckStyleContrast, diffDeckStyleBlock } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { readSourceDeckStyle, setSourceDeckStyle } from "../../src/decks/deckStyleSource.js";
import type { SourceDeckFormat } from "../../src/decks/sourceDecks.js";
import { CASES, blockOf, fixture, withStyle, write } from "./deckStyleHelpers.js";

const editBlock = (format: SourceDeckFormat, text: string, edit: (block: string) => string): string => {
  const block = blockOf(format, text);
  return text.slice(0, block.from) + edit(block.text) + text.slice(block.to);
};
/** Adds a line right after the opening marker. */
const addAfterOpening = (block: string, line: string): string => {
  const lines = block.split("\n");
  lines.splice(1, 0, line);
  return lines.join("\n");
};

describe("3.1c reading a block back", () => {
  it("3.1c gives no block and an empty style for a deck without one", () => {
    for (const { format, file, template } of CASES) {
      const read = readSourceDeckStyle(format, fixture(file))!;
      expect(read.template).toBe(template);
      expect(read.block).toBeNull();
      expect(read.style).toEqual({});
    }
  });

  it("3.1c gives null for a source that is no deck", () => {
    expect(readSourceDeckStyle("latex", "\\documentclass{article}\n\\begin{document}\n\\end{document}\n")).toBeNull();
    expect(readSourceDeckStyle("typst", "= Notes\nPlain.\n")).toBeNull();
  });

  it("3.1c locates a hand-written block from its opening marker line to the end of its closing marker line", () => {
    const input = "\\documentclass{beamer}\n\\usepackage{xcolor}\n  % labshelf:style\n\\definecolor{lsPrimary}{HTML}{ABCDEF}\n  % labshelf:style end\n\\begin{document}\n\\end{document}\n";
    const read = readSourceDeckStyle("latex", input)!;
    const from = input.indexOf("  % labshelf:style\n");
    const to = input.indexOf("\\begin{document}");
    expect(read.block).toEqual({ from, to, text: input.slice(from, to) });
    expect(read.style).toEqual({ primary: "#abcdef" });
  });

  it("3.1c reads only the lines inside the block", () => {
    const input = "\\documentclass{beamer}\n\\definecolor{lsText}{HTML}{000000}\n% labshelf:style\n\\definecolor{lsPrimary}{HTML}{ABCDEF}\n% labshelf:style end\n\\definecolor{lsAccent}{HTML}{000001}\n\\begin{document}\n\\end{document}\n";
    expect(readSourceDeckStyle("latex", input)!.style).toEqual({ primary: "#abcdef" });
  });

  it("3.1c reads hand edits of a LaTeX block and leaves invalid values out", () => {
    const written = write("latex", fixture("defesa-beamer.tex")).text;
    const edited = editBlock("latex", written, (text) => {
      let out = text
        .replace("\\definecolor{lsPrimary}{HTML}{1F5673}", "\\definecolor{lsPrimary}{rgb}{0,0.2,1}")
        .replace("\\definecolor{lsAccent}{HTML}{C75B12}", "\\definecolor{lsAccent}{RGB}{10,20,30}")
        .replace("\\definecolor{lsText}{HTML}{1A1A1A}", "\\definecolor{lsText}{HTML}{ZZZZZZ}")
        .replace("\\setmainfont{Inter}", "\\setmainfont{Charter}")
        .replace("\\setmonofont{JetBrains Mono}", "   \\setmonofont{Fira Code}   ")
        .replace("\\newfontfamily\\lsHeadingFont{Inter}", "\\newfontfamily\\lsHeadingFont[Scale=1.0]{Lato}")
        .replace("\\def\\lsScale{1}", "\\def\\lsScale{abc}");
      out = addAfterOpening(out, "\\renewcommand{\\unknown}{value}");
      return out;
    });
    const read = readSourceDeckStyle("latex", edited)!;
    expect(read.style).toEqual({
      primary: "#0033ff", accent: "#0a141e", background: "#ffffff", muted: "#6b7280",
      headingFont: "Lato", bodyFont: "Charter", monoFont: "Fira Code",
    });
    expect(read.style.text).toBeUndefined();
    expect(read.style.scale).toBeUndefined();
  });

  it("3.1c reads hand edits of a Typst block and leaves invalid values out", () => {
    const written = write("typst", fixture("typst-a0.typ")).text;
    const edited = editBlock("typst", written, (text) => {
      const out = text
        .replace('#let ls-primary = rgb("#1f5673")', "#let ls-primary = rgb(10, 20, 30)")
        .replace('#let ls-body-font = "Inter"', '   #let ls-body-font = "Lato"   ')
        .replace("#let ls-scale = 1", "#let ls-scale = 1.5")
        .replace('#let ls-muted = rgb("#6b7280")', '#let ls-muted = rgb("#zzz")');
      return addAfterOpening(out, "#let ls-extra = 5");
    });
    const read = readSourceDeckStyle("typst", edited)!;
    expect(read.style).toEqual({
      primary: "#0a141e", accent: "#c75b12", background: "#ffffff", text: "#1a1a1a",
      headingFont: "Inter", bodyFont: "Lato", monoFont: "JetBrains Mono", scale: 1.5,
    });
    expect(read.style.muted).toBeUndefined();
  });

  it("3.1c leaves out a scale outside 0.5 to 3 and a font with quotes", () => {
    const written = write("typst", fixture("typst-a0.typ")).text;
    const edited = editBlock("typst", written, (text) => text.replace("#let ls-scale = 1", "#let ls-scale = 9").replace('#let ls-mono-font = "JetBrains Mono"', '#let ls-mono-font = "Fira {Code}"'));
    const style = readSourceDeckStyle("typst", edited)!.style;
    expect(style.scale).toBeUndefined();
    expect(style.monoFont).toBeUndefined();
    expect(style.primary).toBe("#1f5673");
  });

  it("3.1c replaces only the block when a hand-edited block is rewritten", () => {
    const input = fixture("defesa-beamer.tex");
    const written = write("latex", input).text;
    const edited = editBlock("latex", written, (text) => addAfterOpening(text.replace("\\setmainfont{Inter}", "\\setmainfont{Charter}"), "\\renewcommand{\\unknown}{value}"));
    const before = blockOf("latex", edited);
    const rewritten = write("latex", edited, DEFAULT_DECK_STYLE).text;
    const after = blockOf("latex", rewritten);
    expect(rewritten.slice(0, after.from)).toBe(edited.slice(0, before.from));
    expect(rewritten.slice(after.to)).toBe(edited.slice(before.to));
    expect(rewritten).toBe(written);
    expect(rewritten).not.toContain("\\unknown");
    expect(readSourceDeckStyle("latex", rewritten)!.style).toEqual(DEFAULT_DECK_STYLE);
  });

  it("3.1c replaces only the block when a hand-edited Typst block is rewritten", () => {
    const written = write("typst", fixture("typst-relampago.typ")).text;
    const edited = editBlock("typst", written, (text) => addAfterOpening(text.replace('#let ls-body-font = "Inter"', '#let ls-body-font = "Lato"'), "#let ls-extra = 5"));
    const rewritten = write("typst", edited, DEFAULT_DECK_STYLE).text;
    expect(rewritten).toBe(written);
    expect(rewritten).not.toContain("ls-extra");
  });
});

describe("3.1d setSourceDeckStyle refuses", () => {
  it("3.1d returns null for an unknown template", () => {
    expect(setSourceDeckStyle("latex", "\\documentclass{article}\n\\begin{document}\n\\end{document}\n", DEFAULT_DECK_STYLE)).toBeNull();
    expect(setSourceDeckStyle("typst", "= Notes\nPlain text.\n", DEFAULT_DECK_STYLE)).toBeNull();
  });

  it("3.1d returns null for an opening marker without its end in LaTeX", () => {
    const input = "\\documentclass{beamer}\n\\usepackage{xcolor}\n% labshelf:style\n\\definecolor{lsPrimary}{HTML}{ABCDEF}\n\\begin{document}\n\\end{document}\n";
    expect(setSourceDeckStyle("latex", input, DEFAULT_DECK_STYLE)).toBeNull();
    expect(readSourceDeckStyle("latex", input)!.block).toBeNull();
  });

  it("3.1d returns null for an opening marker without its end in Typst", () => {
    const input = "// labshelf: talk\n#set text(size: 20pt)\n// labshelf:style\n#let ls-primary = rgb(\"#123456\")\n\n= Title\n";
    expect(setSourceDeckStyle("typst", input, DEFAULT_DECK_STYLE)).toBeNull();
    expect(readSourceDeckStyle("typst", input)!.block).toBeNull();
  });

  it.each([
    ["a colour that is not hex", { primary: "red" }],
    ["a font with quotes", { bodyFont: 'Fira "Code"' }],
    ["a font with braces", { monoFont: "Fira {Code}" }],
    ["a scale below 0.5", { scale: 0.4 }],
    ["a scale above 3", { scale: 3.5 }],
  ] as Array<[string, Partial<DeckStyle>]>)("3.1d returns null for %s", (_name, patch) => {
    expect(setSourceDeckStyle("latex", fixture("defesa-beamer.tex"), withStyle(patch))).toBeNull();
    expect(setSourceDeckStyle("typst", fixture("typst-a0.typ"), withStyle(patch))).toBeNull();
  });
});

describe("A5 core half for compiled decks", () => {
  it("A5 writes the style block as one SourceDeckChange, reads it back, diffs it and checks its contrast", () => {
    const input = fixture("defesa-beamer.tex");
    const change = setSourceDeckStyle("latex", input, DEFAULT_DECK_STYLE)!;
    expect(Object.keys(change).sort()).toEqual(["cursor", "text"]);
    const read = readSourceDeckStyle("latex", change.text)!;
    expect(change.cursor).toBe(read.block!.from);
    expect(read.style).toEqual(DEFAULT_DECK_STYLE);
    const diff = diffDeckStyleBlock("", read.block!.text);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((l) => l.kind === "added")).toBe(true);
    const pairs = deckStyleContrast(DEFAULT_DECK_STYLE);
    expect(pairs.map((p) => p.pair)).toEqual(["text", "muted", "primary", "accent"]);
    expect(pairs.every((p) => p.ok)).toBe(true);
  });
});
