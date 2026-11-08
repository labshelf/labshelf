import { gestureEdit, gestureRect, nudgeEdit, selectBlock, type DeckGesture, type DeckSelection } from "../../src/decks/deckGestures";

const snapOptions = { others: [], canvas: { width: 1600, height: 1200 } };
const start = { left: 96, top: 96, width: 100, height: 50 };

describe("gestureRect", () => {
  it("5.2c a move shifts the start by the screen delta divided by the scale", () => {
    const gesture: DeckGesture = { kind: "move", block: "b1", start, origin: { x: 10, y: 10 } };
    expect(gestureRect(gesture, { x: 74, y: 42 }, { scale: 2, snap: snapOptions })).toEqual({
      rect: { left: 128, top: 112, width: 100, height: 50 },
      guides: [],
      cell: null,
    });
  });

  it("5.2c a move snaps through snapDeckRect with the gesture scale", () => {
    const gesture: DeckGesture = { kind: "move", block: "b1", start, origin: { x: 0, y: 0 } };
    expect(gestureRect(gesture, { x: -46.5, y: 0 }, { scale: 0.5, snap: snapOptions })).toEqual({
      rect: { left: 0, top: 96, width: 100, height: 50 },
      guides: [{ axis: "x", at: 0, from: 0, to: 1200 }],
      cell: null,
    });
  });

  it("5.2c a move with snapping disabled follows the pointer exactly", () => {
    const gesture: DeckGesture = { kind: "move", block: "b1", start, origin: { x: 0, y: 0 } };
    expect(gestureRect(gesture, { x: 10, y: 6 }, { scale: 4, snap: { ...snapOptions, disabled: true } }).rect).toEqual({
      left: 98.5,
      top: 97.5,
      width: 100,
      height: 50,
    });
  });

  it("5.2c a se resize moves the right and bottom edges", () => {
    const gesture: DeckGesture = { kind: "resize", block: "b1", handle: "se", start, origin: { x: 0, y: 0 } };
    expect(gestureRect(gesture, { x: 20, y: 6 }, { scale: 1, snap: snapOptions }).rect).toEqual({ left: 96, top: 96, width: 120, height: 56 });
  });

  it("5.2c a w resize moves only the left edge", () => {
    const gesture: DeckGesture = { kind: "resize", block: "b1", handle: "w", start, origin: { x: 0, y: 0 } };
    expect(gestureRect(gesture, { x: -16, y: 30 }, { scale: 1, snap: snapOptions }).rect).toEqual({ left: 80, top: 96, width: 116, height: 50 });
  });

  it("5.2c a nw resize at scale 2 moves the left and top edges by half the screen delta", () => {
    const gesture: DeckGesture = { kind: "resize", block: "b1", handle: "nw", start, origin: { x: 100, y: 100 } };
    expect(gestureRect(gesture, { x: 68, y: 84 }, { scale: 2, snap: snapOptions }).rect).toEqual({ left: 80, top: 88, width: 116, height: 58 });
  });
});

describe("gestureEdit", () => {
  it("5.2c a changed move gives a move edit", () => {
    const gesture: DeckGesture = { kind: "move", block: "b1", start, origin: { x: 0, y: 0 } };
    expect(gestureEdit(gesture, { left: 128, top: 112, width: 100, height: 50 })).toEqual({ kind: "move", block: "b1", left: 128, top: 112 });
  });

  it("5.2c a changed resize gives a resize edit", () => {
    const gesture: DeckGesture = { kind: "resize", block: "b2", handle: "se", start, origin: { x: 0, y: 0 } };
    expect(gestureEdit(gesture, { left: 96, top: 96, width: 120, height: 56 })).toEqual({
      kind: "resize",
      block: "b2",
      left: 96,
      top: 96,
      width: 120,
      height: 56,
    });
  });

  it("5.2c an unchanged move gives null", () => {
    const gesture: DeckGesture = { kind: "move", block: "b1", start, origin: { x: 0, y: 0 } };
    expect(gestureEdit(gesture, { ...start })).toBeNull();
  });

  it("5.2c an unchanged resize gives null", () => {
    const gesture: DeckGesture = { kind: "resize", block: "b1", handle: "e", start, origin: { x: 0, y: 0 } };
    expect(gestureEdit(gesture, { ...start })).toBeNull();
  });

  it("5.2c a released gesture from gestureRect gives its edit", () => {
    const gesture: DeckGesture = { kind: "move", block: "b1", start, origin: { x: 10, y: 10 } };
    const { rect } = gestureRect(gesture, { x: 74, y: 42 }, { scale: 2, snap: snapOptions });
    expect(gestureEdit(gesture, rect)).toEqual({ kind: "move", block: "b1", left: 128, top: 112 });
  });
});

describe("nudgeEdit", () => {
  const rect = { left: 10, top: 20, width: 30, height: 40 };

  it("5.2c nudges by 1 px", () => {
    expect(nudgeEdit("b1", rect, 1, 0)).toEqual({ kind: "move", block: "b1", left: 11, top: 20 });
    expect(nudgeEdit("b1", rect, 0, -1)).toEqual({ kind: "move", block: "b1", left: 10, top: 19 });
  });

  it("5.2c nudges by 10 px", () => {
    expect(nudgeEdit("b1", rect, -10, 0)).toEqual({ kind: "move", block: "b1", left: 0, top: 20 });
    expect(nudgeEdit("b1", rect, 0, 10)).toEqual({ kind: "move", block: "b1", left: 10, top: 30 });
  });
});

describe("selectBlock", () => {
  const selection: DeckSelection = { slide: 2, blocks: ["a"] };

  it("5.2e a plain select replaces the blocks and keeps the slide", () => {
    expect(selectBlock(selection, "b", false)).toEqual({ slide: 2, blocks: ["b"] });
    expect(selectBlock({ slide: 2, blocks: ["a", "c"] }, "a", false)).toEqual({ slide: 2, blocks: ["a"] });
  });

  it("5.2e an additive select adds a block that is not selected", () => {
    expect(selectBlock(selection, "b", true)).toEqual({ slide: 2, blocks: ["a", "b"] });
  });

  it("5.2e an additive select removes a block that is selected", () => {
    expect(selectBlock({ slide: 2, blocks: ["a", "b"] }, "a", true)).toEqual({ slide: 2, blocks: ["b"] });
  });

  it("5.2e null clears the blocks and keeps the slide", () => {
    expect(selectBlock({ slide: 2, blocks: ["a", "b"] }, null, false)).toEqual({ slide: 2, blocks: [] });
    expect(selectBlock({ slide: 2, blocks: ["a", "b"] }, null, true)).toEqual({ slide: 2, blocks: [] });
  });
});
