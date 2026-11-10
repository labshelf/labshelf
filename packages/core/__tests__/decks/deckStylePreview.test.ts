// Spec 4.2: the build copy of a LaTeX or Typst deck that previews a candidate style.
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { setSourceDeckStyle } from "../../src/decks/deckStyleSource.js";
import { stylePreviewSource } from "../../src/decks/deckStylePreview.js";
import { fixture } from "./deckStyleFixtures.js";

const STYLE: DeckStyle = { ...DEFAULT_DECK_STYLE, primary: "#123456", scale: 1.25 };
const frames = (text: string): string[] => text.match(/\\begin\{frame\}[^\n]*/g) ?? [];

describe("4.2a stylePreviewSource", () => {
  it("4.2a keeps the preamble with the style block and only the chosen frame of a beamer talk, page 1", () => {
    const beamer = fixture("defesa-beamer.tex");
    const copy = stylePreviewSource("latex", beamer, STYLE, 2)!;
    expect(copy.page).toBe(1);
    expect(frames(copy.text)).toEqual(["\\begin{frame}{Results}"]);
    expect(copy.text).toContain("% labshelf:style\n");
    expect(copy.text).toContain("\\definecolor{lsPrimary}{HTML}{123456}");
    expect(copy.text).toContain("\\usepackage{amsmath,amssymb,graphicx}");
    expect(copy.text).toContain("\\end{document}");
    expect(copy.text).not.toContain("Motivation");
    expect(copy.text).not.toContain("Thank you!");
  });

  it("4.2a changes no byte outside the style block and the removed frames", () => {
    const beamer = fixture("defesa-beamer.tex");
    const styled = setSourceDeckStyle("latex", beamer, STYLE)!.text;
    const copy = stylePreviewSource("latex", beamer, STYLE, 0)!.text;
    const kept = styled.slice(0, styled.indexOf("\\begin{frame}"));
    expect(copy.startsWith(kept)).toBe(true);
    expect(copy.endsWith("\n\\end{document}\n")).toBe(true);
    expect(frames(copy)).toEqual(["\\begin{frame}"]);
    expect(copy).toContain("\\titlepage");
  });

  it("4.2a is null for a slide the talk does not have", () => {
    expect(stylePreviewSource("latex", fixture("defesa-beamer.tex"), STYLE, 9)).toBeNull();
  });

  it("4.2a keeps a Typst talk whole with the block and gives the slide's page", () => {
    const typst = fixture("touying.typ");
    const copy = stylePreviewSource("typst", typst, STYLE, 1)!;
    expect(copy.text).toBe(setSourceDeckStyle("typst", typst, STYLE)!.text);
    expect(copy.text).toContain("// labshelf:style");
    expect(copy.page).toBe(2);
  });

  it("4.2a keeps a poster whole and gives page 1", () => {
    const tikz = fixture("a1-tikz.tex");
    const copy = stylePreviewSource("latex", tikz, STYLE, 3)!;
    expect(copy.text).toBe(setSourceDeckStyle("latex", tikz, STYLE)!.text);
    expect(copy.page).toBe(1);
    const typstPoster = fixture("peace-of-posters.typ");
    expect(stylePreviewSource("typst", typstPoster, STYLE, 0)).toEqual({ text: setSourceDeckStyle("typst", typstPoster, STYLE)!.text, page: 1 });
  });

  it("4.2a is null for an unknown template or an invalid style", () => {
    expect(stylePreviewSource("latex", "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n", STYLE, 0)).toBeNull();
    expect(stylePreviewSource("typst", "= Notes\nPlain.\n", STYLE, 0)).toBeNull();
    expect(stylePreviewSource("latex", fixture("defesa-beamer.tex"), { ...STYLE, primary: "red" }, 0)).toBeNull();
  });
});
