import { createDeckHistory, type DeckHistory, type DeckSnapshot } from "../../src/decks/deckHistory";

const snap = (html: string, theme = "t"): DeckSnapshot => ({ html, theme });

function undoAll(history: DeckHistory): DeckSnapshot[] {
  const seen: DeckSnapshot[] = [];
  for (let step = 0; step < 1000; step++) {
    const previous = history.undo();
    if (previous === undefined) break;
    seen.push(previous);
  }
  return seen;
}

describe("createDeckHistory", () => {
  it("5.2d starts at the initial snapshot with nothing to undo or redo", () => {
    const history = createDeckHistory(snap("a"));
    expect(history.current()).toEqual(snap("a"));
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBeUndefined();
    expect(history.current()).toEqual(snap("a"));
  });

  it("5.2d undo and redo move current and return it", () => {
    const history = createDeckHistory(snap("a"));
    history.push(snap("b"));
    history.push(snap("c"));
    expect(history.current()).toEqual(snap("c"));
    expect(history.undo()).toEqual(snap("b"));
    expect(history.current()).toEqual(snap("b"));
    expect(history.undo()).toEqual(snap("a"));
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeUndefined();
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toEqual(snap("b"));
    expect(history.redo()).toEqual(snap("c"));
    expect(history.current()).toEqual(snap("c"));
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeUndefined();
  });

  it("5.2d push clears redo", () => {
    const history = createDeckHistory(snap("a"));
    history.push(snap("b"));
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.push(snap("c"));
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toEqual(snap("a"));
  });

  it("5.2d a push equal to current is ignored", () => {
    const history = createDeckHistory(snap("a"));
    history.push(snap("b"));
    history.undo();
    history.push(snap("a"));
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(history.current()).toEqual(snap("a"));
  });

  it("5.2d a snapshot differing only in theme is pushed", () => {
    const history = createDeckHistory(snap("a", "t1"));
    history.push(snap("a", "t2"));
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toEqual(snap("a", "t1"));
  });

  it("5.2d past the limit the oldest snapshots are dropped", () => {
    const history = createDeckHistory(snap("s0"), 3);
    for (let index = 1; index <= 10; index++) history.push(snap(`s${index}`));
    const seen = undoAll(history).map((entry) => entry.html);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBeLessThanOrEqual(3);
    expect(seen).toEqual(["s9", "s8", "s7"].slice(0, seen.length));
    expect(seen).not.toContain("s0");
  });

  it("5.2d the default limit is 100 snapshots", () => {
    const history = createDeckHistory(snap("s0"));
    for (let index = 1; index <= 150; index++) history.push(snap(`s${index}`));
    const seen = undoAll(history).map((entry) => entry.html);
    expect(seen.length).toBeGreaterThanOrEqual(99);
    expect(seen.length).toBeLessThanOrEqual(100);
    expect(seen[0]).toBe("s149");
    expect(seen).not.toContain("s0");
  });

  it("5.2d reset clears both stacks with a new current", () => {
    const history = createDeckHistory(snap("a"));
    history.push(snap("b"));
    history.push(snap("c"));
    history.undo();
    history.reset(snap("z", "t9"));
    expect(history.current()).toEqual(snap("z", "t9"));
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBeUndefined();
  });
});
