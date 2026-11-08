// Spec 8.1: grid-cell classes on blocks, read by parseDeck and readDeckCell, validated by validateDeck, written by place and cleared by move and resize.
// Written as if the file sat at packages/core/__tests__/decks/deckCells.test.ts; relative imports are resolved from there.
import { readDeckCell } from "../../src/decks/deckCells";
import { applyDeckEdit, type DeckEdit } from "../../src/decks/deckEdit";
import { deckCellRect, defaultDeckGrid } from "../../src/decks/deckGrid";
import { parseDeck, type DeckBlock } from "../../src/decks/deckParse";
import { deckCanvasPx } from "../../src/decks/deckSizes";
import { validateDeck } from "../../src/decks/deckValidate";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const GRID_THEME = `${THEME}:root { --deck-grid-columns: 4; --deck-grid-rows: 2; --deck-grid-margin: 60px; --deck-grid-gutter: 20px; }\n`;
const FILES: ReadonlySet<string> = new Set(["theme.css", "assets/plot.png"]);

function deckHtml(slides: string[], { kind = "talk", size = "1920x1080px" }: { kind?: string; size?: string } = {}): string {
  return [
    "<!doctype html>",
    `<html lang="en" data-deck="${kind}" data-deck-version="1" data-deck-size="${size}">`,
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Sample deck</title>",
    '  <link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    ...slides.map((slide) => `  ${slide}`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const slide = (...children: string[]): string => `<section data-slide>${children.map((child) => `\n    ${child}`).join("")}\n  </section>`;

const PX_BLOCK = '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>';
const CELL_BLOCK = '<div data-block="card" class="col-2 row-1 span-3 rows-2"><p>Card</p></div>';
const MIXED_BLOCK = '<div data-block="mixed" class="card col-2 row-1 span-3 rows-2 wide" style="color: red"><p>Mixed</p></div>';

function swap(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`expected exactly one occurrence of ${JSON.stringify(from)}, found ${parts.length - 1}`);
  return `${parts[0]}${to}${parts[1]}`;
}

function edited(html: string, edit: DeckEdit): string {
  const result = applyDeckEdit(html, edit);
  if (!result.ok) throw new Error(`edit refused: ${result.error}`);
  return result.html;
}

function expectRefused(html: string, edit: DeckEdit): void {
  const result = applyDeckEdit(html, edit);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.error).toBe("string");
  expect(result.error.trim().length).toBeGreaterThan(0);
}

function blocksOf(html: string, theme?: string): DeckBlock[] {
  const { model } = parseDeck(html, theme === undefined ? undefined : { theme });
  if (!model) throw new Error("deck did not parse");
  return model.slides.flatMap((s) => s.blocks);
}

const blockOf = (html: string, id: string, theme?: string): DeckBlock => {
  const block = blocksOf(html, theme).find((candidate) => candidate.id === id);
  if (!block) throw new Error(`no block ${id}`);
  return block;
};

const startTagOf = (html: string, id: string): string => {
  const block = blockOf(html, id);
  return html.slice(block.startTag.from, block.startTag.to);
};

const styleValue = (tag: string): string | null => /\sstyle="([^"]*)"/.exec(tag)?.[1] ?? null;
const classTokens = (tag: string): string[] => (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);
const errorsOf = (html: string, theme = THEME) => validateDeck(html, { theme, files: FILES }).filter((d) => d.severity === "error");
const CANVAS = { width: 1920, height: 1080 };

describe("readDeckCell", () => {
  it("8.1b reads the four classes", () => {
    expect(readDeckCell("col-2 row-1 span-3 rows-2")).toEqual({ col: 2, row: 1, span: 3, rows: 2 });
  });

  it("8.1b reads them in any order among other classes", () => {
    expect(readDeckCell("rows-1 card span-4 wide row-3 col-5 accent")).toEqual({ col: 5, row: 3, span: 4, rows: 1 });
  });

  it("8.1b accepts numbers up to 24", () => {
    expect(readDeckCell("col-24 row-24 span-24 rows-24")).toEqual({ col: 24, row: 24, span: 24, rows: 24 });
  });

  it("8.1b gives null for an empty class value or no cell classes", () => {
    expect(readDeckCell("")).toBeNull();
    expect(readDeckCell("card wide")).toBeNull();
  });

  it.each(["col-2 row-1 span-3", "row-1 span-3 rows-2", "col-2 span-3 rows-2", "col-2 row-1 rows-2"])("8.1b gives null when a class is missing in %p", (value) => {
    expect(readDeckCell(value)).toBeNull();
  });

  it.each(["col-0 row-1 span-1 rows-1", "col-x row-1 span-1 rows-1", "col-1 row-1 span-0 rows-1", "col-1 row-1 span-1 rows--1", "col-1 row-abc span-1 rows-1"])("8.1b gives null when a class is invalid in %p", (value) => {
    expect(readDeckCell(value)).toBeNull();
  });
});

describe("parseDeck grid cells", () => {
  it("8.1b a block with the four classes and no px geometry has its cell and the rect of the default grid", () => {
    const html = deckHtml([slide('<div data-block="full" class="col-1 row-1 span-12 rows-6"><p>Full</p></div>')]);
    const block = blockOf(html, "full");
    expect(block.cell).toEqual({ col: 1, row: 1, span: 12, rows: 6 });
    expect(block.rect).toEqual({ left: 80, top: 80, width: 1760, height: 920 });
  });

  it("8.1b the rect of a cell comes from the theme's grid", () => {
    const html = deckHtml([slide('<div data-block="card" class="col-2 row-2 span-2 rows-1"><p>Card</p></div>')]);
    const block = blockOf(html, "card", GRID_THEME);
    expect(block.cell).toEqual({ col: 2, row: 2, span: 2, rows: 1 });
    expect(block.rect).toEqual({ left: 515, top: 550, width: 890, height: 470 });
  });

  it("8.1b without a theme option the default grid is used", () => {
    const html = deckHtml([slide(CELL_BLOCK)]);
    const expected = deckCellRect({ col: 2, row: 1, span: 3, rows: 2 }, defaultDeckGrid(CANVAS), CANVAS);
    expect(blockOf(html, "card").rect).toEqual(expected);
    expect(parseDeck(html).model?.slides[0]?.blocks[0]?.rect).toEqual(expected);
  });

  it("8.1b the grid is the one of the deck's canvas", () => {
    const html = deckHtml([slide('<div data-block="card" class="col-1 row-1 span-12 rows-6"><p>Card</p></div>')], { size: "1440x1080px" });
    const canvas = deckCanvasPx({ w: 1440, h: 1080, unit: "px" });
    expect(blockOf(html, "card").rect).toEqual(deckCellRect({ col: 1, row: 1, span: 12, rows: 6 }, defaultDeckGrid(canvas), canvas));
  });

  it("8.1b a poster in mm lays its cells out on its canvas in px", () => {
    const html = deckHtml([slide('<div data-block="card" class="col-1 row-1 span-6 rows-3"><p>Card</p></div>')], { kind: "poster", size: "841x1189mm" });
    const canvas = deckCanvasPx({ w: 841, h: 1189, unit: "mm" });
    expect(blockOf(html, "card").rect).toEqual(deckCellRect({ col: 1, row: 1, span: 6, rows: 3 }, defaultDeckGrid(canvas), canvas));
  });

  it("8.1b classes may come in any order among other classes", () => {
    const html = deckHtml([slide('<div data-block="card" class="rows-2 note span-3 col-2 row-1 wide"><p>Card</p></div>')]);
    expect(blockOf(html, "card").cell).toEqual({ col: 2, row: 1, span: 3, rows: 2 });
  });

  it("8.1b px geometry wins over the classes and leaves the cell unset", () => {
    const html = deckHtml([slide('<div data-block="both" class="col-2 row-1 span-3 rows-2" style="left: 10px; top: 20px; width: 300px; height: 200px;"><p>Both</p></div>')]);
    const block = blockOf(html, "both");
    expect(block.cell).toBeUndefined();
    expect(block.rect).toEqual({ left: 10, top: 20, width: 300, height: 200 });
  });

  it("8.1b a single px property is enough for px geometry to win", () => {
    const html = deckHtml([slide('<div data-block="half" class="col-2 row-1 span-3 rows-2" style="left: 10px;"><p>Half</p></div>')]);
    expect(blockOf(html, "half").cell).toBeUndefined();
  });

  it("8.1b other style declarations do not stop a cell block from being a cell", () => {
    const html = deckHtml([slide('<div data-block="styled" class="col-1 row-1 span-2 rows-1" style="color: red"><p>Styled</p></div>')]);
    expect(blockOf(html, "styled").cell).toEqual({ col: 1, row: 1, span: 2, rows: 1 });
  });

  it("8.1b a px block has no cell and no change in its rect", () => {
    const block = blockOf(deckHtml([slide(PX_BLOCK)]), "title");
    expect(block.cell).toBeUndefined();
    expect(block.rect).toEqual({ left: 120, top: 80, width: 1680, height: 200 });
  });

  it("8.1b partial cell classes leave the cell unset and the rect null", () => {
    const html = deckHtml([slide('<div data-block="part" class="col-2 row-1 span-3"><p>Part</p></div>')]);
    const block = blockOf(html, "part");
    expect(block.cell).toBeUndefined();
    expect(block.rect).toBeNull();
  });

  it("8.1b partial cell classes with px geometry keep the px rect", () => {
    const html = deckHtml([slide('<div data-block="part" class="col-2 row-1" style="left: 1px; top: 2px; width: 3px; height: 4px;"><p>Part</p></div>')]);
    const block = blockOf(html, "part");
    expect(block.cell).toBeUndefined();
    expect(block.rect).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it("8.1b classes out of range for the grid leave the cell unset", () => {
    const html = deckHtml([slide('<div data-block="wide" class="col-12 row-1 span-2 rows-1"><p>Wide</p></div>')]);
    const block = blockOf(html, "wide");
    expect(block.cell).toBeUndefined();
    expect(block.rect).toBeNull();
  });

  it("8.1b a cell in range for the default grid is out of range for a smaller theme grid", () => {
    const html = deckHtml([slide('<div data-block="card" class="col-3 row-1 span-3 rows-1"><p>Card</p></div>')]);
    expect(blockOf(html, "card").cell).toEqual({ col: 3, row: 1, span: 3, rows: 1 });
    expect(blockOf(html, "card", GRID_THEME).cell).toBeUndefined();
  });

  it("8.1b classRange is the range of the class attribute value", () => {
    const html = deckHtml([slide(MIXED_BLOCK)]);
    const block = blockOf(html, "mixed");
    expect(block.classRange).not.toBeNull();
    expect(html.slice(block.classRange!.from, block.classRange!.to)).toBe("card col-2 row-1 span-3 rows-2 wide");
  });

  it("8.1b classRange is null when the block has no class attribute", () => {
    expect(blockOf(deckHtml([slide(PX_BLOCK)]), "title").classRange).toBeNull();
  });

  it("8.1b reads data-group into group and leaves it unset otherwise", () => {
    const html = deckHtml([slide('<div data-block="a" data-group="team" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>', PX_BLOCK)]);
    expect(blockOf(html, "a").group).toBe("team");
    expect(blockOf(html, "title").group).toBeUndefined();
  });
});

describe("validateDeck grid cells", () => {
  it("8.1e a block with a cell and no px geometry is valid", () => {
    expect(errorsOf(deckHtml([slide(CELL_BLOCK)]))).toEqual([]);
  });

  it("8.1e a cell block of the theme's grid is valid", () => {
    const html = deckHtml([slide('<div data-block="card" class="col-2 row-2 span-2 rows-1"><p>Card</p></div>')]);
    expect(errorsOf(html, GRID_THEME)).toEqual([]);
  });

  it("8.1e a cell block raises no DECK011", () => {
    const codes = validateDeck(deckHtml([slide(CELL_BLOCK)]), { theme: THEME, files: FILES }).map((d) => d.code);
    expect(codes).not.toContain("DECK011");
  });

  it("8.1e partial cell classes without px geometry are DECK011", () => {
    const html = deckHtml([slide('<div data-block="part" class="col-2 row-1 span-3"><p>Part</p></div>')]);
    expect(errorsOf(html).map((d) => d.code)).toContain("DECK011");
  });

  it("8.1e out-of-range cell classes without px geometry are DECK011", () => {
    const html = deckHtml([slide('<div data-block="wide" class="col-12 row-1 span-2 rows-1"><p>Wide</p></div>')]);
    expect(errorsOf(html).map((d) => d.code)).toContain("DECK011");
  });

  it("8.1e a grid cell fills the canvas inside the margins without DECK012", () => {
    const html = deckHtml([slide('<div data-block="full" class="col-1 row-1 span-12 rows-6"><p>Full</p></div>')]);
    expect(errorsOf(html).map((d) => d.code)).not.toContain("DECK012");
  });
});

describe("applyDeckEdit place", () => {
  it("8.1c writes the four classes after data-block and removes the px geometry", () => {
    const html = deckHtml([slide(PX_BLOCK)]);
    const expected = swap(html, 'data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"', 'data-block="title" class="col-1 row-1 span-12 rows-1"');
    expect(applyDeckEdit(html, { kind: "place", block: "title", cell: { col: 1, row: 1, span: 12, rows: 1 } })).toEqual({ ok: true, html: expected });
  });

  it("A8 a block placed on grid lines is written as cell classes with no px geometry", () => {
    const html = edited(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "title", cell: { col: 3, row: 2, span: 4, rows: 3 } });
    const tag = startTagOf(html, "title");
    expect(classTokens(tag)).toEqual(["col-3", "row-2", "span-4", "rows-3"]);
    expect(tag).not.toMatch(/\b(left|top|width|height):/);
    expect(blockOf(html, "title").cell).toEqual({ col: 3, row: 2, span: 4, rows: 3 });
  });

  it("8.1c keeps the other style declarations", () => {
    const html = deckHtml([slide('<div data-block="body" style="left: 5px; top: 6px; color: red; width: 7px; height: 8px;"><p>Body</p></div>')]);
    const tag = startTagOf(edited(html, { kind: "place", block: "body", cell: { col: 2, row: 1, span: 2, rows: 2 } }), "body");
    const style = styleValue(tag);
    expect(style).not.toBeNull();
    expect(style).toContain("color: red");
    expect(style).not.toMatch(/\b(left|top|width|height)\s*:/);
  });

  it("8.1c removes a style attribute that is left empty", () => {
    const tag = startTagOf(edited(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "title", cell: { col: 1, row: 1, span: 1, rows: 1 } }), "title");
    expect(tag).not.toContain("style");
  });

  it("8.1c keeps other classes and replaces the old cell classes", () => {
    const html = edited(deckHtml([slide(MIXED_BLOCK)]), { kind: "place", block: "mixed", cell: { col: 4, row: 3, span: 1, rows: 1 } });
    const tokens = classTokens(startTagOf(html, "mixed"));
    expect(tokens.slice().sort()).toEqual(["card", "col-4", "row-3", "rows-1", "span-1", "wide"]);
    expect(blockOf(html, "mixed").cell).toEqual({ col: 4, row: 3, span: 1, rows: 1 });
  });

  it("8.1c replaces the cell of a cell block", () => {
    const html = edited(deckHtml([slide(CELL_BLOCK)]), { kind: "place", block: "card", cell: { col: 1, row: 2, span: 2, rows: 1 } });
    expect(classTokens(startTagOf(html, "card")).slice().sort()).toEqual(["col-1", "row-2", "rows-1", "span-2"]);
  });

  it("8.1c keeps the block's content and every other block byte for byte", () => {
    const other = '<div data-block="other" style="left: 1px; top: 2px; width: 3px; height: 4px;"><p>Other</p></div>';
    const html = deckHtml([slide(PX_BLOCK, other)]);
    const result = edited(html, { kind: "place", block: "title", cell: { col: 1, row: 1, span: 6, rows: 2 } });
    expect(result).toContain("<h1>Title</h1></div>");
    expect(result).toContain(other);
    expect(result.startsWith(html.slice(0, html.indexOf("<div data-block=\"title\"")))).toBe(true);
  });

  it("8.1c the placed deck validates and the rect follows the grid", () => {
    const html = edited(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "title", cell: { col: 1, row: 1, span: 12, rows: 6 } });
    expect(errorsOf(html)).toEqual([]);
    expect(blockOf(html, "title").rect).toEqual({ left: 80, top: 80, width: 1760, height: 920 });
  });

  it.each([
    ["col past the grid", { col: 13, row: 1, span: 1, rows: 1 }],
    ["span past the grid", { col: 12, row: 1, span: 2, rows: 1 }],
    ["rows past the grid", { col: 1, row: 6, span: 1, rows: 2 }],
    ["row past the grid", { col: 1, row: 7, span: 1, rows: 1 }],
    ["col 0", { col: 0, row: 1, span: 1, rows: 1 }],
    ["span 0", { col: 1, row: 1, span: 0, rows: 1 }],
    ["rows 0", { col: 1, row: 1, span: 1, rows: 0 }],
    ["negative row", { col: 1, row: -1, span: 1, rows: 1 }],
    ["fractional col", { col: 1.5, row: 1, span: 1, rows: 1 }],
    ["NaN span", { col: 1, row: 1, span: Number.NaN, rows: 1 }],
  ])("8.1c refuses an invalid cell: %s", (_name, cell) => {
    expectRefused(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "title", cell });
  });

  it("8.1c refuses an unknown block", () => {
    expectRefused(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "missing", cell: { col: 1, row: 1, span: 1, rows: 1 } });
  });

  it("8.1c accepts the last cell of the default grid", () => {
    const html = edited(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "title", cell: { col: 12, row: 6, span: 1, rows: 1 } });
    expect(blockOf(html, "title").cell).toEqual({ col: 12, row: 6, span: 1, rows: 1 });
  });
});

describe("applyDeckEdit move and resize on a cell block", () => {
  it("8.1c resize drops the cell classes and writes px", () => {
    const html = deckHtml([slide(CELL_BLOCK)]);
    const expected = swap(html, 'data-block="card" class="col-2 row-1 span-3 rows-2"', 'data-block="card" style="left: 1px; top: 2px; width: 3px; height: 4px;"');
    expect(applyDeckEdit(html, { kind: "resize", block: "card", left: 1, top: 2, width: 3, height: 4 })).toEqual({ ok: true, html: expected });
  });

  it("8.1c resize leaves a block with a px rect and no cell", () => {
    const html = edited(deckHtml([slide(CELL_BLOCK)]), { kind: "resize", block: "card", left: 10, top: 20, width: 300, height: 200 });
    const block = blockOf(html, "card");
    expect(block.cell).toBeUndefined();
    expect(block.rect).toEqual({ left: 10, top: 20, width: 300, height: 200 });
    expect(errorsOf(html)).toEqual([]);
  });

  it("8.1c move drops the cell classes and writes left and top", () => {
    const html = edited(deckHtml([slide(CELL_BLOCK)]), { kind: "move", block: "card", left: 10, top: 20 });
    const tag = startTagOf(html, "card");
    expect(tag).not.toContain("class");
    expect(tag).not.toMatch(/\b(col|row|span|rows)-\d/);
    const style = styleValue(tag);
    expect(style).toContain("left: 10px");
    expect(style).toContain("top: 20px");
    expect(blockOf(html, "card").cell).toBeUndefined();
  });

  it("8.1c move and resize keep other classes and other declarations", () => {
    const moved = startTagOf(edited(deckHtml([slide(MIXED_BLOCK)]), { kind: "move", block: "mixed", left: 7, top: 8 }), "mixed");
    expect(classTokens(moved).slice().sort()).toEqual(["card", "wide"]);
    expect(styleValue(moved)).toContain("color: red");
    expect(styleValue(moved)).toContain("left: 7px");
    const resized = startTagOf(edited(deckHtml([slide(MIXED_BLOCK)]), { kind: "resize", block: "mixed", left: 1, top: 2, width: 3, height: 4 }), "mixed");
    expect(classTokens(resized).slice().sort()).toEqual(["card", "wide"]);
    expect(styleValue(resized)).toContain("color: red");
    expect(styleValue(resized)).toContain("width: 3px");
  });

  it("8.1c move on a px block with other classes keeps its classes untouched", () => {
    const html = deckHtml([slide('<div data-block="px" class="card wide" style="left: 1px; top: 2px; width: 3px; height: 4px;"><p>Px</p></div>')]);
    const expected = swap(html, "left: 1px; top: 2px;", "left: 9px; top: 8px;");
    expect(applyDeckEdit(html, { kind: "move", block: "px", left: 9, top: 8 })).toEqual({ ok: true, html: expected });
  });

  it("8.1c place then resize returns to px geometry", () => {
    const placed = edited(deckHtml([slide(PX_BLOCK)]), { kind: "place", block: "title", cell: { col: 1, row: 1, span: 2, rows: 1 } });
    const resized = edited(placed, { kind: "resize", block: "title", left: 120, top: 80, width: 1680, height: 200 });
    expect(resized).toBe(deckHtml([slide(PX_BLOCK)]));
  });
});
