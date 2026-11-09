// Spec 9.3: new-slide layouts written as grid-cell classes (9.3a), the beamer title colours (9.3d) and the denser slide Grid (9.3d).
// Written as if the file sat at packages/core/__tests__/decks/deckSlideLayouts.test.ts; relative imports are resolved from there.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DECK_SLIDE_LAYOUTS, deckSlideLayoutHtml, type DeckSlideLayout } from "../../src/decks/deckSlideLayouts";
import { parseDeck, type DeckModel } from "../../src/decks/deckParse";
import { validateDeck } from "../../src/decks/deckValidate";
import { readSourceDeckStyle, setSourceDeckStyle } from "../../src/decks/deckStyleSource";
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens";

const CANVAS = { width: 1920, height: 1080 };
const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const GRID_THEME = `${THEME}:root { --deck-grid-columns: 4; --deck-grid-rows: 2; --deck-grid-margin: 60px; --deck-grid-gutter: 20px; }\n`;
const ODD_THEME = `${THEME}:root { --deck-grid-columns: 5; --deck-grid-rows: 3; }\n`;
const ONE_ROW_THEME = `${THEME}:root { --deck-grid-columns: 12; --deck-grid-rows: 1; }\n`;
const ONE_COLUMN_THEME = `${THEME}:root { --deck-grid-columns: 1; --deck-grid-rows: 6; }\n`;
const FILES: ReadonlySet<string> = new Set(["theme.css"]);

const block = (id: string, cls: string, text: string): string => `<div data-block="${id}" class="${cls}"><p>${text}</p></div>`;
const section = (...blocks: string[]): string => `<section data-slide>\n  ${blocks.join("\n  ")}\n</section>`;

function deckHtml(slides: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Sample deck</title>",
    '  <link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    ...slides.map((s) => `  ${s}`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function modelOf(slides: string[], theme = THEME): DeckModel {
  const { model } = parseDeck(deckHtml(slides), { theme });
  if (!model) throw new Error("deck did not parse");
  return model;
}

const EXISTING = section(block("title-1", "col-1 row-1 span-12 rows-1", "Old"), block("text-1", "col-1 row-2 span-12 rows-5", "Old"));

const layoutHtml = (layout: DeckSlideLayout, theme = THEME, model?: DeckModel): string => deckSlideLayoutHtml(model, layout, theme, CANVAS);

describe("9.3a DECK_SLIDE_LAYOUTS", () => {
  it("9.3a lists the four layouts with their labels in order", () => {
    expect(DECK_SLIDE_LAYOUTS.map(([id, label]) => [id, label])).toEqual([
      ["title", "Title"],
      ["title-text", "Title and text"],
      ["two-columns", "Two columns"],
      ["blank", "Blank"],
    ]);
  });
});

describe("9.3a deckSlideLayoutHtml on the default 12 x 6 grid", () => {
  it("9.3a writes the title layout as one block at col-2 row-3 span-10 rows-1", () => {
    expect(layoutHtml("title")).toBe(section(block("title-1", "col-2 row-3 span-10 rows-1", "Title")));
  });

  it("9.3a writes the title-text layout as a full-width title and a text of five rows", () => {
    expect(layoutHtml("title-text")).toBe(section(
      block("title-1", "col-1 row-1 span-12 rows-1", "Title"),
      block("text-1", "col-1 row-2 span-12 rows-5", "Text"),
    ));
  });

  it("9.3a writes the two-columns layout as the title and two half-width columns", () => {
    expect(layoutHtml("two-columns")).toBe(section(
      block("title-1", "col-1 row-1 span-12 rows-1", "Title"),
      block("text-1", "col-1 row-2 span-6 rows-5", "Left column"),
      block("text-2", "col-7 row-2 span-6 rows-5", "Right column"),
    ));
  });

  it("9.3a writes the blank layout as an empty section with the indented empty line", () => {
    expect(layoutHtml("blank")).toBe("<section data-slide>\n  \n</section>");
  });

  it("9.3a writes cell classes without a style attribute", () => {
    for (const [layout] of DECK_SLIDE_LAYOUTS) expect(layoutHtml(layout)).not.toContain("style=");
  });

  it("9.3a parses the written blocks back to the cells of the decision", () => {
    const model = modelOf([layoutHtml("two-columns")]);
    expect(model.slides[0]!.blocks.map((b) => [b.id, b.cell])).toEqual([
      ["title-1", { col: 1, row: 1, span: 12, rows: 1 }],
      ["text-1", { col: 1, row: 2, span: 6, rows: 5 }],
      ["text-2", { col: 7, row: 2, span: 6, rows: 5 }],
    ]);
  });
});

describe("9.3a deckSlideLayoutHtml on a custom --deck-grid-* theme", () => {
  it("9.3a reads a 4 x 2 grid for the title layout (col 2, span 2, row 1)", () => {
    expect(layoutHtml("title", GRID_THEME)).toBe(section(block("title-1", "col-2 row-1 span-2 rows-1", "Title")));
  });

  it("9.3a reads a 4 x 2 grid for title-text (text of one row)", () => {
    expect(layoutHtml("title-text", GRID_THEME)).toBe(section(
      block("title-1", "col-1 row-1 span-4 rows-1", "Title"),
      block("text-1", "col-1 row-2 span-4 rows-1", "Text"),
    ));
  });

  it("9.3a reads a 4 x 2 grid for two-columns (halves of two columns)", () => {
    expect(layoutHtml("two-columns", GRID_THEME)).toBe(section(
      block("title-1", "col-1 row-1 span-4 rows-1", "Title"),
      block("text-1", "col-1 row-2 span-2 rows-1", "Left column"),
      block("text-2", "col-3 row-2 span-2 rows-1", "Right column"),
    ));
  });

  it("9.3a splits an odd number of columns with the extra column on the right", () => {
    expect(layoutHtml("two-columns", ODD_THEME)).toBe(section(
      block("title-1", "col-1 row-1 span-5 rows-1", "Title"),
      block("text-1", "col-1 row-2 span-2 rows-2", "Left column"),
      block("text-2", "col-3 row-2 span-3 rows-2", "Right column"),
    ));
  });

  it("9.3a centres the title layout on the row ceil(R / 2)", () => {
    expect(layoutHtml("title", ODD_THEME)).toBe(section(block("title-1", "col-2 row-2 span-3 rows-1", "Title")));
  });

  it("9.3a uses the full width for the title layout when the grid has fewer than 3 columns", () => {
    const theme = `${THEME}:root { --deck-grid-columns: 2; --deck-grid-rows: 4; }\n`;
    expect(layoutHtml("title", theme)).toBe(section(block("title-1", "col-1 row-2 span-2 rows-1", "Title")));
  });
});

describe("9.3a deckSlideLayoutHtml on a grid too small", () => {
  const rect = (id: string, left: number, top: number, width: number, height: number, text: string): string =>
    `<div data-block="${id}" style="left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;"><p>${text}</p></div>`;

  it("9.3a falls back to px rects for title-text on a one-row grid", () => {
    expect(layoutHtml("title-text", ONE_ROW_THEME)).toBe(section(
      rect("title-1", 115, 86, 1690, 151, "Title"),
      rect("text-1", 115, 280, 1690, 714, "Text"),
    ));
  });

  it("9.3a falls back to px rects for two-columns on a one-row grid", () => {
    const html = layoutHtml("two-columns", ONE_ROW_THEME);
    expect(html).not.toMatch(/class="[^"]*(col|row|span|rows)-\d/);
    expect(html).toMatch(/data-block="title-1" style="left: 115px; top: 86px; width: 1690px; height: 151px;"/);
    expect(html.match(/style="/g)).toHaveLength(3);
  });

  it("9.3a falls back to px rects for two-columns on a one-column grid", () => {
    const html = layoutHtml("two-columns", ONE_COLUMN_THEME);
    expect(html).not.toMatch(/class="[^"]*(col|row|span|rows)-\d/);
    expect(html.match(/style="/g)).toHaveLength(3);
  });

  it("9.3a still writes the title layout by cells on a one-row grid", () => {
    expect(layoutHtml("title", ONE_ROW_THEME)).toBe(section(block("title-1", "col-2 row-1 span-10 rows-1", "Title")));
  });

  it("9.3a still writes title-text by cells on a one-column grid", () => {
    expect(layoutHtml("title-text", ONE_COLUMN_THEME)).toBe(section(
      block("title-1", "col-1 row-1 span-1 rows-1", "Title"),
      block("text-1", "col-1 row-2 span-1 rows-5", "Text"),
    ));
  });
});

describe("9.3a deckSlideLayoutHtml block ids", () => {
  it("9.3a gives ids free in the model", () => {
    const model = modelOf([EXISTING]);
    expect(layoutHtml("title-text", THEME, model)).toBe(section(
      block("title-2", "col-1 row-1 span-12 rows-1", "Title"),
      block("text-2", "col-1 row-2 span-12 rows-5", "Text"),
    ));
  });

  it("9.3a numbers the two columns after the ids taken in the deck", () => {
    const html = layoutHtml("two-columns", THEME, modelOf([EXISTING]));
    expect(html).toContain('data-block="title-2"');
    expect(html).toContain('data-block="text-2"');
    expect(html).toContain('data-block="text-3"');
  });

  it("9.3a counts ids in every slide of the deck", () => {
    const other = section(block("title-1", "col-1 row-1 span-12 rows-1", "A"), block("title-2", "col-1 row-2 span-12 rows-1", "B"));
    const model = modelOf([EXISTING, other]);
    expect(layoutHtml("title", THEME, model)).toContain('data-block="title-3"');
  });

  it("9.3a starts at title-1 and text-1 when there is no model", () => {
    const html = layoutHtml("two-columns", THEME, undefined);
    expect(html).toContain('data-block="title-1"');
    expect(html).toContain('data-block="text-1"');
    expect(html).toContain('data-block="text-2"');
  });

  it("9.3a adds no block to the blank layout whatever the model holds", () => {
    expect(layoutHtml("blank", THEME, modelOf([EXISTING]))).toBe("<section data-slide>\n  \n</section>");
  });
});

describe("9.3a the written slide validates", () => {
  const errorsOf = (html: string, theme: string) => validateDeck(html, { theme, files: FILES }).filter((d) => d.severity === "error");

  it.each(DECK_SLIDE_LAYOUTS.map(([id]) => [id] as const))("9.3a %s validates with no error on the default grid", (layout) => {
    expect(errorsOf(deckHtml([layoutHtml(layout)]), THEME)).toEqual([]);
  });

  it.each(DECK_SLIDE_LAYOUTS.map(([id]) => [id] as const))("9.3a %s validates with no error on a custom grid", (layout) => {
    expect(errorsOf(deckHtml([layoutHtml(layout, GRID_THEME)]), GRID_THEME)).toEqual([]);
  });

  it.each(DECK_SLIDE_LAYOUTS.map(([id]) => [id] as const))("9.3a %s validates with no error on a too-small grid", (layout) => {
    expect(errorsOf(deckHtml([layoutHtml(layout, ONE_ROW_THEME)]), ONE_ROW_THEME)).toEqual([]);
  });

  it("9.3a a layout added to a deck that already holds blocks validates with no error", () => {
    const model = modelOf([EXISTING]);
    const html = deckHtml([EXISTING, layoutHtml("two-columns", THEME, model)]);
    expect(errorsOf(html, THEME)).toEqual([]);
  });
});

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("9.3d the beamer Style block title lines", () => {
  const TITLE = "\\setbeamercolor{title}{fg=lsPrimary,bg=lsBackground}";
  const FRAMETITLE = "\\setbeamercolor{frametitle}{fg=lsPrimary,bg=lsBackground}";

  it.each(["defesa-beamer.tex", "beamerposter.tex"])("9.3d writes fg=lsPrimary,bg=lsBackground for title and frametitle in %s", (file) => {
    const change = setSourceDeckStyle("latex", fixture(file), DEFAULT_DECK_STYLE);
    expect(change).not.toBeNull();
    const lines = change!.text.split("\n").map((line) => line.trim());
    expect(lines).toContain(TITLE);
    expect(lines).toContain(FRAMETITLE);
    expect(lines).not.toContain("\\setbeamercolor{title}{fg=lsPrimary}");
    expect(lines).not.toContain("\\setbeamercolor{frametitle}{fg=lsPrimary}");
  });

  it("9.3d leaves the other beamer colour lines as they were", () => {
    const text = setSourceDeckStyle("latex", fixture("defesa-beamer.tex"), DEFAULT_DECK_STYLE)!.text;
    const lines = text.split("\n").map((line) => line.trim());
    for (const line of [
      "\\setbeamercolor{normal text}{fg=lsText,bg=lsBackground}",
      "\\setbeamercolor{background canvas}{bg=lsBackground}",
      "\\setbeamercolor{structure}{fg=lsPrimary}",
      "\\setbeamercolor{block title}{fg=lsBackground,bg=lsPrimary}",
      "\\setbeamercolor{alerted text}{fg=lsAccent}",
      "\\setbeamercolor{footline}{fg=lsMuted}",
    ]) expect(lines).toContain(line);
  });

  it("9.3d still reads the written block back as the same style", () => {
    const text = setSourceDeckStyle("latex", fixture("defesa-beamer.tex"), DEFAULT_DECK_STYLE)!.text;
    expect(readSourceDeckStyle("latex", text)!.style).toEqual(DEFAULT_DECK_STYLE);
  });
});

describe("9.3d the slide Grid", () => {
  it("9.3d lays the slide Grid out in two columns, as it shares the preview's window with the code", () => {
    const css = readFileSync(join(__dirname, "../../src/decks/dom/workspace/slideGrid.css"), "utf8");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });
});
