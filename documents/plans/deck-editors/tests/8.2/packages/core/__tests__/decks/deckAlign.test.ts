import type { DeckEdit } from "../../src/decks/deckEdit";
import { alignDeckBlocks, distributeDeckBlocks, type DeckAlignSide, type DeckItem } from "../../src/decks/deckAlign";

const canvas = { width: 1000, height: 600 };

const byBlock = (edits: readonly DeckEdit[]) =>
  [...edits].sort((a, b) => String((a as { block: string }).block).localeCompare(String((b as { block: string }).block)));
const move = (block: string, left: number, top: number): DeckEdit => ({ kind: "move", block, left, top });

describe("alignDeckBlocks with one unit", () => {
  const item: DeckItem = { id: "a", rect: { left: 100, top: 100, width: 200, height: 50 } };

  it.each<[DeckAlignSide, DeckEdit]>([
    ["left", move("a", 0, 100)],
    ["center", move("a", 400, 100)],
    ["right", move("a", 800, 100)],
    ["top", move("a", 100, 0)],
    ["middle", move("a", 100, 275)],
    ["bottom", move("a", 100, 550)],
  ])("8.2e one item aligned %s goes to the canvas", (side, edit) => {
    expect(alignDeckBlocks([item], side, canvas)).toEqual([edit]);
  });

  it("8.2e an item already in place gives no edit", () => {
    expect(alignDeckBlocks([{ id: "a", rect: { left: 0, top: 100, width: 200, height: 50 } }], "left", canvas)).toEqual([]);
  });

  it("8.2e values are rounded to 2 decimals", () => {
    const thin: DeckItem = { id: "a", rect: { left: 100, top: 0, width: 100, height: 3.3333 } };
    expect(alignDeckBlocks([thin], "middle", canvas)).toEqual([move("a", 100, 298.33)]);
  });

  it("8.2e a lone group aligns to the canvas as one unit", () => {
    const items: DeckItem[] = [
      { id: "a", rect: { left: 100, top: 100, width: 100, height: 50 }, group: "g" },
      { id: "b", rect: { left: 300, top: 100, width: 100, height: 50 }, group: "g" },
    ];
    expect(byBlock(alignDeckBlocks(items, "left", canvas))).toEqual([move("a", 0, 100), move("b", 200, 100)]);
  });

  it("8.2e no items give no edits", () => {
    expect(alignDeckBlocks([], "left", canvas)).toEqual([]);
  });
});

describe("alignDeckBlocks with several units", () => {
  // union: left 50, right 500, top 100, bottom 500
  const items: DeckItem[] = [
    { id: "a", rect: { left: 100, top: 100, width: 100, height: 50 } },
    { id: "b", rect: { left: 300, top: 200, width: 200, height: 100 } },
    { id: "c", rect: { left: 50, top: 400, width: 100, height: 100 } },
  ];

  it("8.2e left aligns every unit to the union's left and skips the one in place", () => {
    expect(byBlock(alignDeckBlocks(items, "left", canvas))).toEqual([move("a", 50, 100), move("b", 50, 200)]);
  });

  it("8.2e right aligns to the union's right and skips the one in place", () => {
    expect(byBlock(alignDeckBlocks(items, "right", canvas))).toEqual([move("a", 400, 100), move("c", 400, 400)]);
  });

  it("8.2e center aligns to the union's horizontal centre", () => {
    expect(byBlock(alignDeckBlocks(items, "center", canvas))).toEqual([move("a", 225, 100), move("b", 175, 200), move("c", 225, 400)]);
  });

  it("8.2e top aligns to the union's top and skips the one in place", () => {
    expect(byBlock(alignDeckBlocks(items, "top", canvas))).toEqual([move("b", 300, 100), move("c", 50, 100)]);
  });

  it("8.2e middle aligns to the union's vertical centre", () => {
    expect(byBlock(alignDeckBlocks(items, "middle", canvas))).toEqual([move("a", 100, 275), move("b", 300, 250), move("c", 50, 250)]);
  });

  it("8.2e bottom aligns to the union's bottom and skips the one in place", () => {
    expect(byBlock(alignDeckBlocks(items, "bottom", canvas))).toEqual([move("a", 100, 450), move("b", 300, 400)]);
  });

  it("8.2e a group is one unit with its union rect and moves as a whole", () => {
    const withGroup: DeckItem[] = [
      { id: "a", rect: { left: 100, top: 100, width: 100, height: 50 }, group: "g" },
      { id: "b", rect: { left: 300, top: 100, width: 100, height: 50 }, group: "g" },
      { id: "c", rect: { left: 600, top: 300, width: 100, height: 100 } },
    ];
    expect(byBlock(alignDeckBlocks(withGroup, "center", canvas))).toEqual([move("a", 250, 100), move("b", 450, 100), move("c", 350, 300)]);
  });

  it("8.2e aligning a group's side to the union moves every item of the group by one delta", () => {
    const withGroup: DeckItem[] = [
      { id: "a", rect: { left: 100, top: 100, width: 100, height: 50 }, group: "g" },
      { id: "b", rect: { left: 300, top: 100, width: 100, height: 50 }, group: "g" },
      { id: "c", rect: { left: 600, top: 300, width: 100, height: 100 } },
    ];
    expect(byBlock(alignDeckBlocks(withGroup, "right", canvas))).toEqual([move("a", 400, 100), move("b", 600, 100)]);
    expect(byBlock(alignDeckBlocks(withGroup, "left", canvas))).toEqual([move("c", 100, 300)]);
  });
});

describe("distributeDeckBlocks", () => {
  const box = (id: string, left: number, width: number, top = 0, height = 50, group?: string): DeckItem => ({ id, rect: { left, top, width, height }, ...(group ? { group } : {}) });

  it("8.2e fewer than three units give no edits", () => {
    expect(distributeDeckBlocks([box("a", 0, 100), box("b", 300, 100)], "x")).toEqual([]);
    expect(distributeDeckBlocks([], "y")).toEqual([]);
  });

  it("8.2e a group and one block are two units, so nothing is distributed", () => {
    const items = [box("a", 0, 100, 0, 50, "g"), box("b", 200, 100, 0, 50, "g"), box("c", 700, 100)];
    expect(distributeDeckBlocks(items, "x")).toEqual([]);
  });

  it("8.2e three blocks get equal gaps and the ends stay", () => {
    const items = [box("a", 0, 100), box("b", 120, 50), box("c", 400, 200)];
    expect(distributeDeckBlocks(items, "x")).toEqual([move("b", 225, 0)]);
  });

  it("8.2e units are sorted by their start before distributing", () => {
    const items = [box("c", 400, 200), box("a", 0, 100), box("b", 120, 50)];
    expect(distributeDeckBlocks(items, "x")).toEqual([move("b", 225, 0)]);
  });

  it("8.2e four blocks all get the same gap", () => {
    const items = [box("a", 0, 100), box("b", 150, 50), box("c", 250, 100), box("d", 700, 100)];
    expect(byBlock(distributeDeckBlocks(items, "x"))).toEqual([move("b", 250, 0), move("c", 450, 0)]);
  });

  it("8.2e distributes along y using tops and heights", () => {
    const tall = (id: string, top: number): DeckItem => ({ id, rect: { left: 40, top, width: 100, height: 100 } });
    expect(distributeDeckBlocks([tall("a", 0), tall("b", 120), tall("c", 500)], "y")).toEqual([move("b", 40, 250)]);
  });

  it("8.2e values are rounded to 2 decimals", () => {
    const items = [box("a", 0, 100), box("b", 150, 100), box("c", 250, 100), box("d", 400, 100)];
    expect(byBlock(distributeDeckBlocks(items, "x"))).toEqual([move("b", 133.33, 0), move("c", 266.67, 0)]);
  });

  it("8.2e a group in the middle moves as a whole by one delta", () => {
    const items = [box("c", 0, 100), box("a", 300, 50, 0, 50, "g"), box("b", 400, 50, 0, 50, "g"), box("d", 800, 100)];
    expect(byBlock(distributeDeckBlocks(items, "x"))).toEqual([move("a", 375, 0), move("b", 475, 0)]);
  });
});
