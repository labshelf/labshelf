// Spec 8.1: the layout grid read from theme.css, the cell geometry, and the base CSS rules for grid cells.
// Written as if the file sat at packages/core/__tests__/decks/deckGrid.test.ts; relative imports are resolved from there.
import { deckCellRect, deckGridCss, deckGridFromTheme, deckGridLines, deckRectCell, defaultDeckGrid, type DeckCell, type DeckGrid } from "../../src/decks/deckGrid";
import { deckBaseCss } from "../../src/decks/deckLayoutCss";
import { deckCanvasPx } from "../../src/decks/deckSizes";

const CANVAS = { width: 1920, height: 1080 };
/** 4 columns of 435 px and 2 rows of 470 px, so every edge is a whole number. */
const SIMPLE: DeckGrid = { columns: 4, rows: 2, margin: 60, gutter: 20 };
const SIMPLE_THEME = ":root { --deck-grid-columns: 4; --deck-grid-rows: 2; --deck-grid-margin: 60px; --deck-grid-gutter: 20px; }";

describe("defaultDeckGrid", () => {
  it("8.1a gives 12 columns, 6 rows, margin width/24 and gutter width/64 for a 1920x1080 canvas", () => {
    expect(defaultDeckGrid(CANVAS)).toEqual({ columns: 12, rows: 6, margin: 80, gutter: 30 });
  });

  it("8.1a rounds the margin and the gutter to whole px", () => {
    expect(defaultDeckGrid({ width: 1000, height: 500 })).toEqual({ columns: 12, rows: 6, margin: 42, gutter: 16 });
  });
});

describe("deckGridFromTheme", () => {
  it("8.1a an empty theme gives the default grid", () => {
    expect(deckGridFromTheme("", CANVAS)).toEqual(defaultDeckGrid(CANVAS));
  });

  it("8.1a a theme without the variables gives the default grid", () => {
    expect(deckGridFromTheme(":root { --deck-bg: #fff; --deck-fg: #111; }\n", CANVAS)).toEqual(defaultDeckGrid(CANVAS));
  });

  it("8.1a reads the four variables", () => {
    expect(deckGridFromTheme(SIMPLE_THEME, CANVAS)).toEqual(SIMPLE);
  });

  it("8.1a reads compact declarations and decimal px values", () => {
    const theme = ":root{--deck-grid-columns:6;--deck-grid-rows:3;--deck-grid-margin:12.5px;--deck-grid-gutter:0px}";
    expect(deckGridFromTheme(theme, CANVAS)).toEqual({ columns: 6, rows: 3, margin: 12.5, gutter: 0 });
  });

  it("8.1a a variable that is missing takes its default while the others are read", () => {
    const grid = deckGridFromTheme(":root { --deck-grid-columns: 8; }", CANVAS);
    expect(grid).toEqual({ ...defaultDeckGrid(CANVAS), columns: 8 });
  });

  it("8.1a accepts the bounds 1 and 24 for columns and rows", () => {
    expect(deckGridFromTheme(":root { --deck-grid-columns: 1; --deck-grid-rows: 24; }", CANVAS)).toMatchObject({ columns: 1, rows: 24 });
    expect(deckGridFromTheme(":root { --deck-grid-columns: 24; --deck-grid-rows: 1; }", CANVAS)).toMatchObject({ columns: 24, rows: 1 });
  });

  it.each(["0", "25", "-3", "abc", "3.5", "6px", ""])("8.1a columns %p is invalid and takes the default", (value) => {
    expect(deckGridFromTheme(`:root { --deck-grid-columns: ${value}; }`, CANVAS).columns).toBe(12);
  });

  it.each(["0", "25", "-1", "two", "2.5"])("8.1a rows %p is invalid and takes the default", (value) => {
    expect(deckGridFromTheme(`:root { --deck-grid-rows: ${value}; }`, CANVAS).rows).toBe(6);
  });

  it.each(["12", "-5px", "5em", "px", "10 px", "abc"])("8.1a margin %p is invalid and takes the default", (value) => {
    expect(deckGridFromTheme(`:root { --deck-grid-margin: ${value}; }`, CANVAS).margin).toBe(80);
  });

  it.each(["7", "-1px", "1rem", "wide"])("8.1a gutter %p is invalid and takes the default", (value) => {
    expect(deckGridFromTheme(`:root { --deck-grid-gutter: ${value}; }`, CANVAS).gutter).toBe(30);
  });

  it("8.1a an invalid variable does not disturb the valid ones", () => {
    const grid = deckGridFromTheme(":root { --deck-grid-columns: 99; --deck-grid-rows: 2; --deck-grid-margin: 60px; --deck-grid-gutter: 20px; }", CANVAS);
    expect(grid).toEqual({ ...SIMPLE, columns: 12 });
  });

  it("8.1a uses the first declaration of a variable when it appears twice", () => {
    const theme = ":root { --deck-grid-columns: 3; }\n.slide { --deck-grid-columns: 5; }\n";
    expect(deckGridFromTheme(theme, CANVAS).columns).toBe(3);
  });

  it("8.1a finds a declaration in any rule, not only :root", () => {
    expect(deckGridFromTheme("[data-slide] { --deck-grid-gutter: 10px; }", CANVAS).gutter).toBe(10);
  });

  it("8.1a ignores declarations inside comments", () => {
    const theme = "/* --deck-grid-columns: 9; --deck-grid-margin: 5px; */\n:root { --deck-grid-columns: 5; }\n";
    expect(deckGridFromTheme(theme, CANVAS)).toEqual({ ...defaultDeckGrid(CANVAS), columns: 5 });
  });

  it("8.1a reads the default of the given canvas for missing variables", () => {
    expect(deckGridFromTheme("", { width: 1000, height: 500 })).toEqual(defaultDeckGrid({ width: 1000, height: 500 }));
  });
});

describe("deckCellRect", () => {
  it("8.1a the whole grid is the canvas inside the margins", () => {
    const grid = defaultDeckGrid(CANVAS);
    expect(deckCellRect({ col: 1, row: 1, span: 12, rows: 6 }, grid, CANVAS)).toEqual({ left: 80, top: 80, width: 1760, height: 920 });
  });

  it("8.1a places a cell at margin plus the columns and gutters before it", () => {
    expect(deckCellRect({ col: 1, row: 1, span: 1, rows: 1 }, SIMPLE, CANVAS)).toEqual({ left: 60, top: 60, width: 435, height: 470 });
    expect(deckCellRect({ col: 2, row: 2, span: 2, rows: 1 }, SIMPLE, CANVAS)).toEqual({ left: 515, top: 550, width: 890, height: 470 });
  });

  it("8.1a a span adds the gutters it crosses", () => {
    expect(deckCellRect({ col: 1, row: 1, span: 4, rows: 2 }, SIMPLE, CANVAS)).toEqual({ left: 60, top: 60, width: 1800, height: 960 });
  });

  it("8.1a rounds every value to 2 decimals", () => {
    // cw = (1920 - 160 - 11 * 30) / 12 = 119.1666..., rh = (1080 - 160 - 5 * 30) / 6 = 128.3333...
    expect(deckCellRect({ col: 1, row: 1, span: 1, rows: 1 }, defaultDeckGrid(CANVAS), CANVAS)).toEqual({ left: 80, top: 80, width: 119.17, height: 128.33 });
    expect(deckCellRect({ col: 2, row: 2, span: 1, rows: 1 }, defaultDeckGrid(CANVAS), CANVAS)).toEqual({ left: 229.17, top: 238.33, width: 119.17, height: 128.33 });
  });

  it("8.1a a grid without margin and gutter divides the canvas evenly", () => {
    const grid: DeckGrid = { columns: 4, rows: 2, margin: 0, gutter: 0 };
    expect(deckCellRect({ col: 3, row: 2, span: 1, rows: 1 }, grid, CANVAS)).toEqual({ left: 960, top: 540, width: 480, height: 540 });
  });
});

describe("deckRectCell", () => {
  it("8.1a gives the cell of a rect that matches it", () => {
    expect(deckRectCell({ left: 515, top: 550, width: 890, height: 470 }, SIMPLE, CANVAS)).toEqual({ col: 2, row: 2, span: 2, rows: 1 });
  });

  it("8.1a matches within 0.5 px on every edge", () => {
    expect(deckRectCell({ left: 515.4, top: 549.6, width: 890.2, height: 470 }, SIMPLE, CANVAS)).toEqual({ col: 2, row: 2, span: 2, rows: 1 });
  });

  it("8.1a gives null when one edge is more than 0.5 px away", () => {
    expect(deckRectCell({ left: 515.6, top: 550, width: 890, height: 470 }, SIMPLE, CANVAS)).toBeNull();
    expect(deckRectCell({ left: 515, top: 550, width: 890, height: 471 }, SIMPLE, CANVAS)).toBeNull();
  });

  it("8.1a gives null for a rect that is not on cells", () => {
    expect(deckRectCell({ left: 100, top: 100, width: 300, height: 200 }, SIMPLE, CANVAS)).toBeNull();
  });

  it("8.1a gives null for a rect that fills a gutter or ends in the middle of a cell", () => {
    expect(deckRectCell({ left: 495, top: 60, width: 20, height: 470 }, SIMPLE, CANVAS)).toBeNull();
    expect(deckRectCell({ left: 60, top: 60, width: 600, height: 470 }, SIMPLE, CANVAS)).toBeNull();
  });

  it("8.1a round-trips deckCellRect for every cell of a small grid", () => {
    const grid: DeckGrid = { columns: 4, rows: 3, margin: 40, gutter: 20 };
    for (let col = 1; col <= 4; col++) {
      for (let span = 1; col + span - 1 <= 4; span++) {
        for (let row = 1; row <= 3; row++) {
          for (let rows = 1; row + rows - 1 <= 3; rows++) {
            const cell: DeckCell = { col, row, span, rows };
            expect(deckRectCell(deckCellRect(cell, grid, CANVAS), grid, CANVAS)).toEqual(cell);
          }
        }
      }
    }
  });

  it("8.1a round-trips cells of the default grid with rounded rects", () => {
    const grid = defaultDeckGrid(CANVAS);
    for (const cell of [{ col: 1, row: 1, span: 1, rows: 1 }, { col: 5, row: 3, span: 4, rows: 2 }, { col: 12, row: 6, span: 1, rows: 1 }, { col: 1, row: 1, span: 12, rows: 6 }]) {
      expect(deckRectCell(deckCellRect(cell, grid, CANVAS), grid, CANVAS)).toEqual(cell);
    }
  });
});

describe("deckGridLines", () => {
  it("8.1a lists the starts and ends of the columns and rows, sorted", () => {
    expect(deckGridLines(SIMPLE, CANVAS)).toEqual({
      x: [60, 495, 515, 950, 970, 1405, 1425, 1860],
      y: [60, 530, 550, 1020],
    });
  });

  it("8.1a de-duplicates lines that coincide when the gutter is 0", () => {
    expect(deckGridLines({ columns: 4, rows: 2, margin: 0, gutter: 0 }, CANVAS)).toEqual({ x: [0, 480, 960, 1440, 1920], y: [0, 540, 1080] });
  });

  it("8.1a writes lines with 2 decimals", () => {
    const { x, y } = deckGridLines(defaultDeckGrid(CANVAS), CANVAS);
    expect(x).toHaveLength(24);
    expect(y).toHaveLength(12);
    expect(x.slice(0, 4)).toEqual([80, 199.17, 229.17, 348.33]);
    expect(y.slice(0, 4)).toEqual([80, 208.33, 238.33, 366.67]);
    expect(x[x.length - 1]).toBe(1840);
    expect(y[y.length - 1]).toBe(1000);
  });
});

describe("deckGridCss", () => {
  const css = deckGridCss();

  it("8.1e has one rule per number 1 to 24 for each of col, span, row and rows", () => {
    const count = (pattern: RegExp): string[] => [...css.matchAll(pattern)].map((match) => match[1]!);
    const expected = Array.from({ length: 24 }, (_, i) => String(i + 1));
    expect(count(/\[data-block\]\.col-(\d+)\{left:/g)).toEqual(expected);
    expect(count(/\[data-block\]\.span-(\d+)\{width:/g)).toEqual(expected);
    expect(count(/\[data-block\]\.row-(\d+)\{top:/g)).toEqual(expected);
    expect(count(/\[data-block\]\.rows-(\d+)\{height:/g)).toEqual(expected);
  });

  it("8.1e has no rule past 24", () => {
    expect(css).not.toContain(".col-25");
    expect(css).not.toContain(".span-25");
    expect(css).not.toContain(".row-0{");
  });

  it("8.1e computes with calc() over the four variables and 100%", () => {
    expect(css).toContain("calc(");
    for (const name of ["--deck-grid-columns", "--deck-grid-rows", "--deck-grid-margin", "--deck-grid-gutter"]) expect(css).toContain(`var(${name})`);
    expect(css).toContain("100%");
  });
});

describe("deckBaseCss grid", () => {
  it("8.1e contains the grid defaults of a 1920x1080 canvas under :where(:root)", () => {
    expect(deckBaseCss({ w: 1920, h: 1080, unit: "px" })).toContain(":where(:root){--deck-grid-columns:12;--deck-grid-rows:6;--deck-grid-margin:80px;--deck-grid-gutter:30px}");
  });

  it("8.1e uses the defaults of the size's own canvas", () => {
    const size = { w: 1440, h: 1080, unit: "px" as const };
    const { margin, gutter } = defaultDeckGrid(deckCanvasPx(size));
    expect(deckBaseCss(size)).toContain(`:where(:root){--deck-grid-columns:12;--deck-grid-rows:6;--deck-grid-margin:${margin}px;--deck-grid-gutter:${gutter}px}`);
  });

  it("8.1e uses the canvas px of a poster in mm", () => {
    const size = { w: 841, h: 1189, unit: "mm" as const };
    const { margin, gutter } = defaultDeckGrid(deckCanvasPx(size));
    expect(deckBaseCss(size)).toContain(`--deck-grid-margin:${margin}px;--deck-grid-gutter:${gutter}px}`);
  });

  it("8.1e contains the col-, span-, row- and rows- rules of deckGridCss", () => {
    const css = deckBaseCss({ w: 1920, h: 1080, unit: "px" });
    expect(css).toContain(deckGridCss());
    expect(css).toContain("[data-block].col-1{left:");
    expect(css).toContain("[data-block].rows-24{height:");
  });

  it("8.1e keeps the slide canvas and absolute block rules", () => {
    const css = deckBaseCss({ w: 1920, h: 1080, unit: "px" });
    expect(css).toContain("[data-slide]{position:relative;box-sizing:border-box;width:1920px;height:1080px;overflow:hidden}");
    expect(css).toContain("[data-block]{position:absolute;box-sizing:border-box}");
  });
});
