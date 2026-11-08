import type { DeckGrid } from "../../src/decks/deckGrid";
import type { DeckRect } from "../../src/decks/deckParse";
import { snapDeckRect, type DeckSnapInput } from "../../src/decks/deckSnap";

const canvas = { width: 1000, height: 600 };
// columns: 20-245, 265-490, 510-735, 755-980; rows: 20-290, 310-580
const grid: DeckGrid = { columns: 4, rows: 2, margin: 20, gutter: 20 };

function snap(rect: DeckRect, overrides: Partial<DeckSnapInput> = {}) {
  return snapDeckRect({ rect, moving: "move", others: [], canvas, scale: 1, ...overrides });
}

const spacing = (guides: readonly { kind?: string }[]) => guides.filter((guide) => guide.kind === "spacing");

describe("snapDeckRect with a layout grid", () => {
  it("8.2a a rect near the lines of one cell snaps to it and reports the cell", () => {
    const result = snap({ left: 22, top: 22, width: 225, height: 270 }, { grid });
    expect(result.rect).toEqual({ left: 20, top: 20, width: 225, height: 270 });
    expect(result.cell).toEqual({ col: 1, row: 1, span: 1, rows: 1 });
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(["x", "y"]);
  });

  it("8.2a a rect spanning two columns reports the span", () => {
    const result = snap({ left: 268, top: 24, width: 470, height: 270 }, { grid });
    expect(result.rect).toEqual({ left: 265, top: 20, width: 470, height: 270 });
    expect(result.cell).toEqual({ col: 2, row: 1, span: 2, rows: 1 });
  });

  it("8.2a a rect in the second row reports that row", () => {
    const result = snap({ left: 512, top: 312, width: 225, height: 270 }, { grid });
    expect(result.rect).toEqual({ left: 510, top: 310, width: 225, height: 270 });
    expect(result.cell).toEqual({ col: 3, row: 2, span: 1, rows: 1 });
  });

  it("8.2a a grid line target draws a full-extent guide like the slide targets", () => {
    const result = snap({ left: 24, top: 136, width: 100, height: 50 }, { grid });
    expect(result.rect).toEqual({ left: 20, top: 136, width: 100, height: 50 });
    expect(result.guides).toEqual([{ axis: "x", at: 20, from: 0, to: 600 }]);
    expect(result.cell).toBeNull();
  });

  it("8.2a a se resize snaps its right and bottom edges to the grid lines", () => {
    const result = snap({ left: 20, top: 20, width: 220, height: 266 }, { grid, moving: "se" });
    expect(result.rect).toEqual({ left: 20, top: 20, width: 225, height: 270 });
    expect(result.cell).toEqual({ col: 1, row: 1, span: 1, rows: 1 });
  });

  it("8.2a a rect away from every line has no cell", () => {
    const result = snap({ left: 136, top: 136, width: 100, height: 50 }, { grid });
    expect(result.rect).toEqual({ left: 136, top: 136, width: 100, height: 50 });
    expect(result.guides).toEqual([]);
    expect(result.cell).toBeNull();
  });

  it("8.2a a snapped rect that is not exactly a cell has no cell", () => {
    const result = snap({ left: 22, top: 136, width: 100, height: 50 }, { grid });
    expect(result.rect.left).toBe(20);
    expect(result.cell).toBeNull();
  });

  it("8.2a the grid threshold is 6 screen px, so it shrinks at a higher scale", () => {
    const rect = { left: 24, top: 136, width: 100, height: 50 };
    expect(snap(rect, { grid, scale: 1 }).rect.left).toBe(20);
    expect(snap(rect, { grid, scale: 2 }).rect.left).toBe(24);
  });

  it("8.2a Alt (disabled) turns snapping off and leaves the cell null", () => {
    const result = snap({ left: 20, top: 20, width: 225, height: 270 }, { grid, disabled: true });
    expect(result.rect).toEqual({ left: 20, top: 20, width: 225, height: 270 });
    expect(result.guides).toEqual([]);
    expect(result.cell).toBeNull();
  });

  it("8.2a without a grid the existing behaviour holds and cell is null", () => {
    expect(snap({ left: 4, top: 96, width: 100, height: 50 })).toEqual({
      rect: { left: 0, top: 96, width: 100, height: 50 },
      guides: [{ axis: "x", at: 0, from: 0, to: 600 }],
      cell: null,
    });
  });

  it("8.2a without a grid a rect near a would-be grid line is not pulled to it", () => {
    const result = snap({ left: 24, top: 136, width: 100, height: 50 });
    expect(result.rect).toEqual({ left: 24, top: 136, width: 100, height: 50 });
    expect(result.cell).toBeNull();
  });
});

describe("snapDeckRect equal spacing", () => {
  const A = { left: 100, top: 100, width: 100, height: 100 };
  const B = { left: 500, top: 100, width: 100, height: 100 };

  it("8.2b a block moved between two others snaps to equal gaps", () => {
    const result = snap({ left: 296, top: 100, width: 100, height: 100 }, { others: [A, B] });
    expect(result.rect.left).toBe(300);
    expect(spacing(result.guides)).toHaveLength(2);
    expect(result.guides).toContainEqual({ axis: "x", kind: "spacing", from: 200, to: 300, at: 150 });
    expect(result.guides).toContainEqual({ axis: "x", kind: "spacing", from: 400, to: 500, at: 150 });
  });

  it("8.2b a spacing snap is not rounded to the 8 px grid", () => {
    const result = snap({ left: 301, top: 100, width: 100, height: 100 }, { others: [A, B] });
    expect(result.rect.left).toBe(300);
  });

  it("8.2b a block moved between two others vertically snaps to equal gaps", () => {
    const top = { left: 100, top: 50, width: 100, height: 80 };
    const bottom = { left: 100, top: 450, width: 100, height: 80 };
    const result = snap({ left: 100, top: 243, width: 100, height: 100 }, { others: [top, bottom] });
    expect(result.rect.top).toBe(240);
    expect(result.guides).toContainEqual({ axis: "y", kind: "spacing", from: 130, to: 240, at: 150 });
    expect(result.guides).toContainEqual({ axis: "y", kind: "spacing", from: 340, to: 450, at: 150 });
  });

  it("8.2b outside the threshold there is no spacing snap", () => {
    const result = snap({ left: 285, top: 100, width: 100, height: 100 }, { others: [A, B] });
    expect(spacing(result.guides)).toEqual([]);
  });

  it("8.2b the chain case snaps to the gap of the neighbour pair before it", () => {
    const first = { left: 60, top: 100, width: 100, height: 100 };
    const second = { left: 260, top: 100, width: 100, height: 100 };
    const result = snap({ left: 457, top: 100, width: 100, height: 100 }, { others: [first, second] });
    expect(result.rect.left).toBe(460);
    expect(result.guides).toContainEqual({ axis: "x", kind: "spacing", from: 160, to: 260, at: 150 });
    expect(result.guides).toContainEqual({ axis: "x", kind: "spacing", from: 360, to: 460, at: 150 });
  });

  it("8.2b the chain case also works mirrored before the following pair", () => {
    const first = { left: 640, top: 100, width: 100, height: 100 };
    const second = { left: 840, top: 100, width: 100, height: 100 };
    const result = snap({ left: 443, top: 100, width: 100, height: 100 }, { others: [first, second] });
    expect(result.rect.left).toBe(440);
    expect(result.guides).toContainEqual({ axis: "x", kind: "spacing", from: 540, to: 640, at: 150 });
    expect(result.guides).toContainEqual({ axis: "x", kind: "spacing", from: 740, to: 840, at: 150 });
  });

  it("8.2b a closer edge target on the axis wins over equal spacing", () => {
    const edge = { left: 296, top: 400, width: 60, height: 50 };
    const result = snap({ left: 295, top: 100, width: 100, height: 100 }, { others: [A, B, edge] });
    expect(result.rect.left).toBe(296);
    expect(spacing(result.guides)).toEqual([]);
  });

  it("8.2b others that do not overlap on the other axis give no spacing snap", () => {
    const low = (rect: DeckRect) => ({ ...rect, top: 400 });
    const result = snap({ left: 297, top: 96, width: 100, height: 96 }, { others: [low(A), low(B)] });
    expect(result.rect.left).toBe(296);
    expect(spacing(result.guides)).toEqual([]);
  });

  it("8.2b a resize gets no spacing guides", () => {
    const result = snap({ left: 300, top: 100, width: 100, height: 100 }, { others: [A, B], moving: "e" });
    expect(result.rect.left).toBe(300);
    expect(spacing(result.guides)).toEqual([]);
  });
});
