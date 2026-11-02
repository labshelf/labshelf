import type { DeckRect } from "../../../src/decks/deckParse";
import { snapDeckRect, type DeckSnapInput, type ResizeHandle } from "../../../src/decks/editor/deckSnap";

const canvas = { width: 1000, height: 600 };

function snap(rect: DeckRect, overrides: Partial<DeckSnapInput> = {}) {
  return snapDeckRect({ rect, moving: "move", others: [], canvas, scale: 1, ...overrides });
}

describe("snapDeckRect moving a block", () => {
  it("5.2a snaps the left edge to the slide start with a full-height guide", () => {
    expect(snap({ left: 4, top: 96, width: 100, height: 50 })).toEqual({
      rect: { left: 0, top: 96, width: 100, height: 50 },
      guides: [{ axis: "x", at: 0, from: 0, to: 600 }],
    });
  });

  it("5.2a snaps the centre to the slide centre", () => {
    expect(snap({ left: 448, top: 96, width: 100, height: 50 })).toEqual({
      rect: { left: 450, top: 96, width: 100, height: 50 },
      guides: [{ axis: "x", at: 500, from: 0, to: 600 }],
    });
  });

  it("5.2a snaps both axes to slide edges with one guide per axis", () => {
    const result = snap({ left: 2, top: 550, width: 100, height: 48 });
    expect(result.rect).toEqual({ left: 0, top: 552, width: 100, height: 48 });
    expect(result.guides).toHaveLength(2);
    expect(result.guides).toContainEqual({ axis: "x", at: 0, from: 0, to: 600 });
    expect(result.guides).toContainEqual({ axis: "y", at: 600, from: 0, to: 1000 });
  });

  it("5.2a snaps to another block's edge with a guide spanning both rects", () => {
    const other = { left: 320, top: 400, width: 200, height: 100 };
    expect(snap({ left: 523, top: 96, width: 80, height: 40 }, { others: [other] })).toEqual({
      rect: { left: 520, top: 96, width: 80, height: 40 },
      guides: [{ axis: "x", at: 520, from: 96, to: 500 }],
    });
  });

  it("5.2a snaps vertically to another block's top with a guide spanning both rects in x", () => {
    const other = { left: 320, top: 400, width: 200, height: 100 };
    expect(snap({ left: 600, top: 397, width: 80, height: 40 }, { others: [other] })).toEqual({
      rect: { left: 600, top: 400, width: 80, height: 40 },
      guides: [{ axis: "y", at: 400, from: 320, to: 680 }],
    });
  });

  it("5.2a the closest pair wins over an earlier but farther target", () => {
    const other = { left: 103, top: 400, width: 50, height: 50 };
    expect(snap({ left: 2, top: 96, width: 100, height: 40 }, { others: [other] })).toEqual({
      rect: { left: 3, top: 96, width: 100, height: 40 },
      guides: [{ axis: "x", at: 103, from: 96, to: 450 }],
    });
  });

  it("5.2a on equal distance the earlier target wins", () => {
    const other = { left: 106, top: 400, width: 50, height: 50 };
    expect(snap({ left: 3, top: 96, width: 100, height: 40 }, { others: [other] })).toEqual({
      rect: { left: 0, top: 96, width: 100, height: 40 },
      guides: [{ axis: "x", at: 0, from: 0, to: 600 }],
    });
  });

  it("5.2a on equal distance between two other blocks the first in order wins", () => {
    const first = { left: 520, top: 400, width: 40, height: 40 };
    const second = { left: 526, top: 200, width: 40, height: 40 };
    expect(snap({ left: 523, top: 96, width: 200, height: 40 }, { others: [first, second] })).toEqual({
      rect: { left: 520, top: 96, width: 200, height: 40 },
      guides: [{ axis: "x", at: 520, from: 96, to: 440 }],
    });
  });

  it("5.2a the threshold is 6 screen px at scale 1, inclusive", () => {
    expect(snap({ left: 6, top: 96, width: 100, height: 50 }).rect.left).toBe(0);
    expect(snap({ left: 7, top: 96, width: 100, height: 50 }).rect.left).toBe(8);
  });

  it("5.2a the threshold shrinks to 3 slide px at scale 2", () => {
    const result = snap({ left: 5, top: 96, width: 100, height: 50 }, { scale: 2 });
    expect(result).toEqual({ rect: { left: 8, top: 96, width: 100, height: 50 }, guides: [] });
    expect(snap({ left: 3, top: 96, width: 100, height: 50 }, { scale: 2 }).rect.left).toBe(0);
  });

  it("5.2a the threshold grows to 12 slide px at scale 0.5", () => {
    expect(snap({ left: 10, top: 200, width: 100, height: 50 }, { scale: 0.5 })).toEqual({
      rect: { left: 0, top: 200, width: 100, height: 50 },
      guides: [{ axis: "x", at: 0, from: 0, to: 600 }],
    });
    expect(snap({ left: 10, top: 200, width: 100, height: 50 }, { scale: 1 }).rect.left).toBe(8);
  });

  it("5.2a the threshold is 4 slide px at scale 1.5", () => {
    expect(snap({ left: 4, top: 96, width: 100, height: 50 }, { scale: 1.5 }).rect.left).toBe(0);
    expect(snap({ left: 5, top: 96, width: 100, height: 50 }, { scale: 1.5 }).rect.left).toBe(8);
  });

  it("5.2a without a target in reach the start edges round to the 8 px grid without guides", () => {
    expect(snap({ left: 13, top: 21, width: 100, height: 50 })).toEqual({
      rect: { left: 16, top: 24, width: 100, height: 50 },
      guides: [],
    });
  });

  it("5.2a disabled leaves the rect, rounded to 2 decimals, without guides", () => {
    expect(snap({ left: 3.14159, top: 2.718, width: 100.456, height: 50 }, { disabled: true })).toEqual({
      rect: { left: 3.14, top: 2.72, width: 100.46, height: 50 },
      guides: [],
    });
  });
});

describe("snapDeckRect resizing a block", () => {
  const big = { width: 1600, height: 1200 };
  const resize = (rect: DeckRect, moving: ResizeHandle, others: DeckRect[] = []) =>
    snapDeckRect({ rect, moving, others, canvas: big, scale: 1 });

  it("5.2b each handle grid-snaps only the edges it moves", () => {
    const rect = { left: 101, top: 101, width: 205, height: 205 };
    const expected: Record<ResizeHandle, DeckRect> = {
      e: { left: 101, top: 101, width: 203, height: 205 },
      w: { left: 104, top: 101, width: 202, height: 205 },
      n: { left: 101, top: 104, width: 205, height: 202 },
      s: { left: 101, top: 101, width: 205, height: 203 },
      ne: { left: 101, top: 104, width: 203, height: 202 },
      nw: { left: 104, top: 104, width: 202, height: 202 },
      se: { left: 101, top: 101, width: 203, height: 203 },
      sw: { left: 104, top: 101, width: 202, height: 203 },
    };
    for (const handle of Object.keys(expected) as ResizeHandle[]) {
      expect({ handle, result: resize(rect, handle) }).toEqual({ handle, result: { rect: expected[handle], guides: [] } });
    }
  });

  it("5.2b the e handle snaps the right edge to another block and leaves the left edge", () => {
    const other = { left: 400, top: 96, width: 100, height: 100 };
    expect(resize({ left: 3, top: 97, width: 394, height: 100 }, "e", [other])).toEqual({
      rect: { left: 3, top: 97, width: 397, height: 100 },
      guides: [{ axis: "x", at: 400, from: 96, to: 197 }],
    });
  });

  it("5.2b the n handle snaps the top edge to the slide centre and keeps the bottom", () => {
    expect(resize({ left: 101, top: 597, width: 205, height: 200 }, "n")).toEqual({
      rect: { left: 101, top: 600, width: 205, height: 197 },
      guides: [{ axis: "y", at: 600, from: 0, to: 1600 }],
    });
  });

  it("5.2b the e handle keeps the width at least 8 px", () => {
    expect(resize({ left: 96, top: 96, width: 2, height: 50 }, "e").rect).toEqual({ left: 96, top: 96, width: 8, height: 50 });
  });

  it("5.2b the w handle keeps the width at least 8 px with the right edge fixed", () => {
    expect(resize({ left: 101, top: 96, width: 3, height: 50 }, "w").rect).toEqual({ left: 96, top: 96, width: 8, height: 50 });
  });

  it("5.2b the n handle keeps the height at least 8 px with the bottom fixed", () => {
    expect(resize({ left: 96, top: 101, width: 50, height: 3 }, "n").rect).toEqual({ left: 96, top: 96, width: 50, height: 8 });
  });

  it("5.2b the se handle turns a negative size into the 8 px minimum", () => {
    expect(resize({ left: 96, top: 96, width: -20, height: -20 }, "se").rect).toEqual({ left: 96, top: 96, width: 8, height: 8 });
  });
});
