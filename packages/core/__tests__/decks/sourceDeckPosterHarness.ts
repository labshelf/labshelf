// Fixtures and helpers shared by the sourceDeckPoster tests: the compiled poster sources and the readers of their column titles and widths.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceDeckBlocks } from "../../src/decks/index.js";
import type { SourceDeckChange } from "../../src/decks/sourceDeckEdit.js";

export type Format = "latex" | "typst";

export const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
export const TIKZ = fixture("a1-tikz.tex");
export const BEAMER = fixture("beamerposter.tex");
export const TYPST = fixture("typst-a0.typ");

/** The block titles of each poster column, read back from the text. */
export const columnTitles = (format: Format, text: string): Array<Array<string | undefined>> =>
  readSourceDeckBlocks(format, "poster", text).filter((node) => node.kind === "column").map((column) => (column.children ?? []).filter((child) => child.kind === "block").map((child) => child.title));
/** Every non-blank line, trimmed and sorted: a move keeps whole lines, so this does not change. */
export const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean).sort();
export const ok = (change: SourceDeckChange | null): string => {
  expect(change).not.toBeNull();
  return change!.text;
};

export const TYPST_GRID = `#set page(width: 841mm, height: 1189mm, margin: 3cm)
#grid(columns: (1fr, 2fr), gutter: 3cm,
  [
    = Introduction
    Intro text.
  ],
  [
    = Results
    Results text.
  ],
)
`;

/** A Typst grid poster with two blocks in each cell. */
export const TYPST_GRID_4 = `#set page(width: 841mm, height: 1189mm, margin: 3cm)
#grid(columns: (1fr, 1fr), gutter: 3cm,
  [
    = Alpha
    Alpha text.

    = Beta
    Beta text.
  ],
  [
    = Gamma
    Gamma text.

    = Delta
    Delta text.
  ],
)
`;

export const TIKZ_3 = `\\documentclass[25pt, a1paper, portrait]{tikzposter}
\\begin{document}
\\begin{columns}
  \\column{0.33}
  \\block{A}{
    a
  }
  \\column{0.33}
  \\block{B}{
    b
  }
  \\column{0.34}
  \\block{C}{
    c
  }
\\end{columns}
\\end{document}
`;

export const widths = (format: Format, text: string): Array<number | undefined> =>
  readSourceDeckBlocks(format, "poster", text).filter((node) => node.kind === "column").map((column) => column.props.columnWidth);
