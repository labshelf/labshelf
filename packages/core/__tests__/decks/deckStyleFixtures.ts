// Helpers the Style block tests of LaTeX and Typst decks share: the fixtures, the decks they cover, and writing and reading the block.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { readSourceDeckStyle, setSourceDeckStyle } from "../../src/decks/deckStyleSource.js";
import type { SourceDeckTemplate } from "../../src/decks/deckStyleSource.js";
import type { SourceDeckFormat } from "../../src/decks/sourceDecks.js";

export const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
export const withStyle = (patch: Partial<DeckStyle>): DeckStyle => ({ ...DEFAULT_DECK_STYLE, ...patch });

export function write(format: SourceDeckFormat, text: string, style: DeckStyle = DEFAULT_DECK_STYLE) {
  const change = setSourceDeckStyle(format, text, style);
  if (change === null) throw new Error("setSourceDeckStyle returned null");
  return change;
}
export function blockOf(format: SourceDeckFormat, text: string) {
  const read = readSourceDeckStyle(format, text);
  if (read === null || read.block === null) throw new Error("no block");
  return read.block;
}

export interface Case {
  name: string;
  format: SourceDeckFormat;
  file: string;
  template: SourceDeckTemplate;
  /** The text the block follows, when the place is exact. */
  after?: string;
  /** The text the block must come before. */
  before: string;
  /** The text the block must come after, when `after` is not exact. */
  notBefore?: string;
}

export const CASES: Case[] = [
  { name: "beamer", format: "latex", file: "defesa-beamer.tex", template: "beamer", after: "\\usepackage{amsmath,amssymb,graphicx}\n", before: "\\title{" },
  { name: "beamerposter", format: "latex", file: "beamerposter.tex", template: "beamerposter", after: "\\usepackage[size=a0,scale=1.4]{beamerposter}\n", before: "\\title{Poster}" },
  { name: "tikzposter", format: "latex", file: "a1-tikz.tex", template: "tikzposter", after: "\\usetheme{Default}\n", before: "\\title{" },
  { name: "typst poster", format: "typst", file: "typst-a0.typ", template: "typst", after: "it.body))\n", before: "#align(center)[" },
  { name: "typst talk", format: "typst", file: "typst-relampago.typ", template: "typst", after: "it.body))\n}\n", before: "#align(center + horizon)[" },
  { name: "touying", format: "typst", file: "touying.typ", template: "touying", notBefore: "#import \"@preview/touying:0.5.2\": *\n", before: "#show: simple-theme" },
  { name: "peace-of-posters", format: "typst", file: "peace-of-posters.typ", template: "peace-of-posters", notBefore: "#pop.set-theme(pop.uni-fr)\n", before: "#pop.title-box(" },
];
