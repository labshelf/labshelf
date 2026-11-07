/**
 * Tests normaliseNoteViewState (plan D9): whatever a host's store hands back, the result is a NoteViewState with string-only
 * entries, at most 500 of each list, and advanced and outline false unless they are true; a `reading` flag from before the Advanced switch is dropped.
 */
import { normaliseNoteViewState, type NoteViewState } from "../../src/qmd/noteViewState";

const EMPTY: NoteViewState = { cells: [], sections: [], advanced: false, outline: false };

describe("normaliseNoteViewState", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "collapsed"],
    ["a number", 7],
    ["a boolean", true],
    ["an array", ["a", "b"]],
    ["an empty object", {}],
  ])("3.3b returns empty defaults for %s", (_name, value) => {
    expect(normaliseNoteViewState(value)).toEqual(EMPTY);
  });

  it("3.3b keeps a valid state as it is", () => {
    const value = { cells: ["load", "cell-2"], sections: ["1:Top:0", "2:Sub:0"], advanced: true, outline: true };
    expect(normaliseNoteViewState(value)).toEqual(value);
  });

  it("3.3b drops non-string entries from cells", () => {
    const result = normaliseNoteViewState({ cells: ["a", 1, null, { k: "b" }, ["c"], "d", undefined, true], sections: [], advanced: false });
    expect(result.cells).toEqual(["a", "d"]);
  });

  it("3.3b drops non-string entries from sections", () => {
    const result = normaliseNoteViewState({ cells: [], sections: [2, "1:Top:0", null, "2:Sub:0", {}], advanced: false });
    expect(result.sections).toEqual(["1:Top:0", "2:Sub:0"]);
  });

  it("3.3b uses an empty list when cells is not an array", () => {
    expect(normaliseNoteViewState({ cells: "a", sections: ["1:Top:0"], advanced: true }).cells).toEqual([]);
  });

  it("3.3b uses an empty list when sections is not an array", () => {
    expect(normaliseNoteViewState({ cells: ["a"], sections: { 0: "x" }, advanced: true }).sections).toEqual([]);
  });

  it("3.3b keeps at most 500 cell keys", () => {
    const cells = Array.from({ length: 800 }, (_, index) => `cell-${index + 1}`);
    const result = normaliseNoteViewState({ cells, sections: [], advanced: false });
    expect(result.cells).toHaveLength(500);
    expect(result.cells.every((key) => cells.includes(key))).toBe(true);
  });

  it("3.3b keeps at most 500 section keys", () => {
    const sections = Array.from({ length: 800 }, (_, index) => `1:Heading ${index}:0`);
    const result = normaliseNoteViewState({ cells: [], sections, advanced: false });
    expect(result.sections).toHaveLength(500);
    expect(result.sections.every((key) => sections.includes(key))).toBe(true);
  });

  it("3.3b keeps exactly 500 entries when 500 are given", () => {
    const cells = Array.from({ length: 500 }, (_, index) => `cell-${index + 1}`);
    expect(normaliseNoteViewState({ cells, sections: [], advanced: false }).cells).toEqual(cells);
  });

  it("defaults advanced to false when it is missing", () => {
    expect(normaliseNoteViewState({ cells: ["a"], sections: [] }).advanced).toBe(false);
  });

  it("keeps advanced true", () => {
    expect(normaliseNoteViewState({ cells: [], sections: [], advanced: true }).advanced).toBe(true);
  });

  it("defaults advanced to false when it is not a boolean", () => {
    expect(normaliseNoteViewState({ cells: [], sections: [], advanced: { on: true } }).advanced).toBe(false);
  });

  it("defaults outline to false unless it is true", () => {
    expect(normaliseNoteViewState({ cells: [], sections: [], advanced: false }).outline).toBe(false);
    expect(normaliseNoteViewState({ cells: [], sections: [], outline: "yes" }).outline).toBe(false);
    expect(normaliseNoteViewState({ cells: [], sections: [], outline: true }).outline).toBe(true);
  });

  it("3.3b does not change its input", () => {
    const value = { cells: ["a", 1], sections: ["1:Top:0", null], advanced: true };
    const copy = JSON.parse(JSON.stringify(value));
    normaliseNoteViewState(value);
    expect(value).toEqual(copy);
  });
});

describe("normaliseNoteViewState outline", () => {
  it("5.2a defaults outline to false for nothing, an empty object and junk", () => {
    expect(normaliseNoteViewState(undefined).outline).toBe(false);
    expect(normaliseNoteViewState({}).outline).toBe(false);
    expect(normaliseNoteViewState("open").outline).toBe(false);
    expect(normaliseNoteViewState(null).outline).toBe(false);
  });

  it("5.2a reads outline true only when it is the boolean true", () => {
    expect(normaliseNoteViewState({ outline: true }).outline).toBe(true);
    expect(normaliseNoteViewState({ outline: "true" }).outline).toBe(false);
    expect(normaliseNoteViewState({ outline: 1 }).outline).toBe(false);
    expect(normaliseNoteViewState({ outline: false }).outline).toBe(false);
  });

  it("5.2a keeps the other fields beside outline", () => {
    const state = normaliseNoteViewState({ cells: ["a"], sections: ["1:T:0"], advanced: true, outline: true });
    expect(state).toEqual({ cells: ["a"], sections: ["1:T:0"], advanced: true, outline: true });
  });
});

describe("a view state saved before the Advanced switch", () => {
  it("drops its reading flag and opens with Advanced off", () => {
    expect(normaliseNoteViewState({ cells: ["a"], sections: [], reading: true, outline: true })).toEqual({ cells: ["a"], sections: [], advanced: false, outline: true });
  });
});
