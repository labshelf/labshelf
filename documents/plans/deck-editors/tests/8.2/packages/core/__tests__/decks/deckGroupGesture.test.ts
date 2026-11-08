import type { DeckEdit } from "../../src/decks/deckEdit";
import type { DeckGrid } from "../../src/decks/deckGrid";
import type { DeckRect } from "../../src/decks/deckParse";
import type { DeckSnapResult } from "../../src/decks/deckSnap";
import { expandGroups, groupEdits, groupGesture, groupRect, marqueeBlocks } from "../../src/decks/deckGroupGesture";

const snapOptions = { others: [], canvas: { width: 1600, height: 1200 } };
const m1 = { id: "m1", rect: { left: 96, top: 96, width: 100, height: 50 } };
const m2 = { id: "m2", rect: { left: 296, top: 200, width: 104, height: 96 } };
const union: DeckRect = { left: 96, top: 96, width: 304, height: 200 };
const result = (rect: DeckRect, cell: DeckSnapResult["cell"] = null): DeckSnapResult => ({ rect, guides: [], cell });
const byBlock = (edits: readonly DeckEdit[]) =>
  [...edits].sort((a, b) => String((a as { block: string }).block).localeCompare(String((b as { block: string }).block)));

describe("groupGesture and groupRect", () => {
  it("8.2c the gesture starts from the union of the member rects", () => {
    const gesture = groupGesture("move", [m1, m2], { x: 5, y: 7 });
    expect(gesture.kind).toBe("move");
    expect(gesture.start).toEqual(union);
    expect(gesture.origin).toEqual({ x: 5, y: 7 });
    expect(gesture.members).toEqual([m1, m2]);
  });

  it("8.2c a resize gesture keeps its handle", () => {
    expect(groupGesture("resize", [m1, m2], { x: 0, y: 0 }, "se").handle).toBe("se");
  });

  it("8.2c a move shifts the union by the screen delta divided by the scale", () => {
    const gesture = groupGesture("move", [m1, m2], { x: 10, y: 10 });
    const moved = groupRect(gesture, { x: 90, y: 58 }, { scale: 2, snap: snapOptions });
    expect(moved.rect).toEqual({ left: 136, top: 120, width: 304, height: 200 });
    expect(moved.guides).toEqual([]);
    expect(moved.cell).toBeNull();
  });

  it("8.2c a move snaps the union like a single rect", () => {
    const gesture = groupGesture("move", [m1, m2], { x: 0, y: 0 });
    const moved = groupRect(gesture, { x: -92, y: 0 }, { scale: 1, snap: snapOptions });
    expect(moved.rect).toEqual({ left: 0, top: 96, width: 304, height: 200 });
    expect(moved.guides).toEqual([{ axis: "x", at: 0, from: 0, to: 1200 }]);
  });

  it("8.2c a move with snapping disabled follows the pointer exactly", () => {
    const gesture = groupGesture("move", [m1, m2], { x: 0, y: 0 });
    const moved = groupRect(gesture, { x: 10, y: 6 }, { scale: 1, snap: { ...snapOptions, disabled: true } });
    expect(moved.rect).toEqual({ left: 106, top: 102, width: 304, height: 200 });
  });

  it("8.2c a se resize moves the right and bottom edges of the union", () => {
    const gesture = groupGesture("resize", [m1, m2], { x: 0, y: 0 }, "se");
    expect(groupRect(gesture, { x: 40, y: 24 }, { scale: 1, snap: snapOptions }).rect).toEqual({ left: 96, top: 96, width: 344, height: 224 });
  });

  it("8.2c a resize keeps the minimum size of 8", () => {
    const gesture = groupGesture("resize", [m1, m2], { x: 0, y: 0 }, "e");
    const resized = groupRect(gesture, { x: -350, y: 0 }, { scale: 1, snap: snapOptions });
    expect(resized.rect.width).toBe(8);
    expect(resized.rect.left).toBe(96);
  });

  it("8.2c the union lands on a cell of the snap grid", () => {
    const grid: DeckGrid = { columns: 4, rows: 2, margin: 20, gutter: 20 };
    const gesture = groupGesture("move", [{ id: "m1", rect: { left: 22, top: 22, width: 225, height: 270 } }], { x: 0, y: 0 });
    const moved = groupRect(gesture, { x: 0, y: 0 }, { scale: 1, snap: { others: [], canvas: { width: 1000, height: 600 }, grid } });
    expect(moved.rect).toEqual({ left: 20, top: 20, width: 225, height: 270 });
    expect(moved.cell).toEqual({ col: 1, row: 1, span: 1, rows: 1 });
  });
});

describe("groupEdits", () => {
  it("8.2c a move of several members gives one move edit each with the union's delta", () => {
    const gesture = groupGesture("move", [m1, m2], { x: 0, y: 0 });
    const edits = groupEdits(gesture, result({ left: 136, top: 120, width: 304, height: 200 }));
    expect(byBlock(edits)).toEqual([
      { kind: "move", block: "m1", left: 136, top: 120 },
      { kind: "move", block: "m2", left: 336, top: 224 },
    ]);
  });

  it("8.2c several members never give a place edit, even on a cell", () => {
    const gesture = groupGesture("move", [m1, m2], { x: 0, y: 0 });
    const edits = groupEdits(gesture, result({ left: 20, top: 20, width: 304, height: 200 }, { col: 1, row: 1, span: 2, rows: 1 }));
    expect(edits).toHaveLength(2);
    expect(edits.every((edit) => edit.kind === "move")).toBe(true);
  });

  it("8.2c a resize of several members maps each one proportionally", () => {
    const gesture = groupGesture("resize", [m1, m2], { x: 0, y: 0 }, "se");
    const edits = groupEdits(gesture, result({ left: 96, top: 96, width: 456, height: 300 }));
    expect(byBlock(edits)).toEqual([
      { kind: "resize", block: "m1", left: 96, top: 96, width: 150, height: 75 },
      { kind: "resize", block: "m2", left: 396, top: 252, width: 156, height: 144 },
    ]);
  });

  it("8.2c proportional resize values are rounded to 2 decimals", () => {
    const gesture = groupGesture("resize", [m1, m2], { x: 0, y: 0 }, "e");
    const edits = groupEdits(gesture, result({ left: 96, top: 96, width: 100, height: 200 }));
    expect(byBlock(edits)).toEqual([
      { kind: "resize", block: "m1", left: 96, top: 96, width: 32.89, height: 50 },
      { kind: "resize", block: "m2", left: 161.79, top: 200, width: 34.21, height: 96 },
    ]);
  });

  it("8.2c a single member moved gives a move edit", () => {
    const gesture = groupGesture("move", [m1], { x: 0, y: 0 });
    expect(groupEdits(gesture, result({ left: 136, top: 120, width: 100, height: 50 }))).toEqual([{ kind: "move", block: "m1", left: 136, top: 120 }]);
  });

  it("8.2c a single member resized gives a resize edit", () => {
    const gesture = groupGesture("resize", [m1], { x: 0, y: 0 }, "se");
    expect(groupEdits(gesture, result({ left: 96, top: 96, width: 120, height: 56 }))).toEqual([
      { kind: "resize", block: "m1", left: 96, top: 96, width: 120, height: 56 },
    ]);
  });

  it("8.2c a single member landing on a cell gives a place edit", () => {
    const cell = { col: 1, row: 1, span: 1, rows: 1 };
    const gesture = groupGesture("move", [m1], { x: 0, y: 0 });
    expect(groupEdits(gesture, result({ left: 20, top: 20, width: 225, height: 270 }, cell))).toEqual([{ kind: "place", block: "m1", cell }]);
  });

  it("8.2c a single member resized onto a cell gives a place edit", () => {
    const cell = { col: 2, row: 1, span: 2, rows: 1 };
    const gesture = groupGesture("resize", [m1], { x: 0, y: 0 }, "se");
    expect(groupEdits(gesture, result({ left: 265, top: 20, width: 470, height: 270 }, cell))).toEqual([{ kind: "place", block: "m1", cell }]);
  });

  it("8.2c no change gives no edits", () => {
    expect(groupEdits(groupGesture("move", [m1, m2], { x: 0, y: 0 }), result(union))).toEqual([]);
    expect(groupEdits(groupGesture("resize", [m1, m2], { x: 0, y: 0 }, "se"), result(union))).toEqual([]);
    expect(groupEdits(groupGesture("move", [m1], { x: 0, y: 0 }), result(m1.rect))).toEqual([]);
  });
});

describe("marqueeBlocks", () => {
  const blocks = [
    { id: "a", rect: { left: 0, top: 0, width: 100, height: 100 } },
    { id: "b", rect: { left: 200, top: 0, width: 100, height: 100 } },
    { id: "c", rect: null },
    { id: "d", rect: { left: 100, top: 0, width: 100, height: 100 } },
  ];

  it("8.2d selects the blocks that overlap the marquee, in input order", () => {
    expect(marqueeBlocks(blocks, { left: 50, top: 50, width: 200, height: 10 })).toEqual(["a", "b", "d"]);
  });

  it("8.2d leaves out blocks the marquee does not reach", () => {
    expect(marqueeBlocks(blocks, { left: 50, top: 50, width: 100, height: 100 })).toEqual(["a", "d"]);
  });

  it("8.2d touching edges do not count", () => {
    expect(marqueeBlocks(blocks, { left: 100, top: 100, width: 100, height: 100 })).toEqual([]);
  });

  it("8.2d a block without a rect is never hit", () => {
    expect(marqueeBlocks(blocks, { left: -50, top: -50, width: 2000, height: 2000 })).toEqual(["a", "b", "d"]);
  });

  it("8.2d an empty area selects nothing", () => {
    expect(marqueeBlocks(blocks, { left: 500, top: 500, width: 50, height: 50 })).toEqual([]);
  });

  it("8.2d a hit group member brings every block of its group", () => {
    const grouped = [
      { id: "x", rect: { left: 400, top: 400, width: 50, height: 50 } },
      { id: "g1", rect: { left: 0, top: 0, width: 50, height: 50 }, group: "g" },
      { id: "y", rect: { left: 300, top: 0, width: 50, height: 50 } },
      { id: "g2", rect: { left: 500, top: 500, width: 50, height: 50 }, group: "g" },
      { id: "g3", rect: null, group: "g" },
      { id: "h1", rect: { left: 700, top: 700, width: 50, height: 50 }, group: "h" },
    ];
    expect(marqueeBlocks(grouped, { left: 10, top: 10, width: 20, height: 20 })).toEqual(["g1", "g2", "g3"]);
  });
});

describe("expandGroups", () => {
  const blocks = [{ id: "a" }, { id: "b", group: "g" }, { id: "c" }, { id: "d", group: "g" }, { id: "e", group: "h" }];

  it("8.2d adds every block that shares a group with one of the ids, in blocks order", () => {
    expect(expandGroups(blocks, ["d"])).toEqual(["b", "d"]);
  });

  it("8.2d keeps ungrouped ids and does not duplicate", () => {
    expect(expandGroups(blocks, ["d", "a", "b"])).toEqual(["a", "b", "d"]);
  });

  it("8.2d no ids give no ids", () => {
    expect(expandGroups(blocks, [])).toEqual([]);
  });
});

describe("a multi-block gesture end to end", () => {
  it("A8 a marquee over one group member moves the whole group as one set of edits", () => {
    const blocks = [
      { id: "g1", rect: m1.rect, group: "g" },
      { id: "g2", rect: m2.rect, group: "g" },
      { id: "solo", rect: { left: 800, top: 800, width: 100, height: 100 } },
    ];
    const ids = marqueeBlocks(blocks, { left: 100, top: 100, width: 10, height: 10 });
    expect(ids).toEqual(["g1", "g2"]);
    const members = blocks.filter((block) => ids.includes(block.id)).map(({ id, rect }) => ({ id, rect }));
    const gesture = groupGesture("move", members, { x: 0, y: 0 });
    const moved = groupRect(gesture, { x: 40, y: 24 }, { scale: 1, snap: snapOptions });
    expect(byBlock(groupEdits(gesture, moved))).toEqual([
      { kind: "move", block: "g1", left: 136, top: 120 },
      { kind: "move", block: "g2", left: 336, top: 224 },
    ]);
  });

  it("A8 a single block released on grid lines is written as a place edit", () => {
    const grid: DeckGrid = { columns: 4, rows: 2, margin: 20, gutter: 20 };
    const gesture = groupGesture("move", [{ id: "solo", rect: { left: 22, top: 22, width: 225, height: 270 } }], { x: 0, y: 0 });
    const moved = groupRect(gesture, { x: 0, y: 0 }, { scale: 1, snap: { others: [], canvas: { width: 1000, height: 600 }, grid } });
    expect(groupEdits(gesture, moved)).toEqual([{ kind: "place", block: "solo", cell: { col: 1, row: 1, span: 1, rows: 1 } }]);
  });

  it("A8 with snapping disabled the same release is written as a move edit", () => {
    const grid: DeckGrid = { columns: 4, rows: 2, margin: 20, gutter: 20 };
    const gesture = groupGesture("move", [{ id: "solo", rect: { left: 20, top: 20, width: 225, height: 270 } }], { x: 0, y: 0 });
    const moved = groupRect(gesture, { x: 3, y: 5 }, { scale: 1, snap: { others: [], canvas: { width: 1000, height: 600 }, grid, disabled: true } });
    expect(groupEdits(gesture, moved)).toEqual([{ kind: "move", block: "solo", left: 23, top: 25 }]);
  });
});
