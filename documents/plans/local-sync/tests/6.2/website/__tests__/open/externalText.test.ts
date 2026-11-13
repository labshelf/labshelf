// Pins how an open editor takes in a text the Mirror file system hands it: the rebase against the editor's current text and the cursor mapping.
import { createTextMerge } from "@labshelf/core";
import { diff3Merge } from "node-diff3";
import { mapCursor, rebaseExternalText } from "../../src/open/externalText";

const textMerge = createTextMerge(diff3Merge);
const PATH = "notes/a.txt";

const PREVIOUS = ["one", "two", "three", "four", "five"].join("\n") + "\n";

describe("rebasing an external text onto the editor's text", () => {
  it("6.2a gives the new text when the editor still holds the previous text", () => {
    const text = PREVIOUS.replace("four", "FOUR");
    expect(rebaseExternalText(PATH, PREVIOUS, { previous: PREVIOUS, text }, textMerge)).toBe(text);
  });

  it("6.2a keeps an editor edit in another line together with the other side's edit", () => {
    const current = PREVIOUS.replace("one", "ONE");
    const text = PREVIOUS.replace("five", "FIVE");
    const next = rebaseExternalText(PATH, current, { previous: PREVIOUS, text }, textMerge);
    expect(next).toBe(["ONE", "two", "three", "four", "FIVE"].join("\n") + "\n");
  });

  it("6.2a gives undefined when both sides edit the same line differently", () => {
    const current = PREVIOUS.replace("three", "mine");
    const text = PREVIOUS.replace("three", "theirs");
    expect(rebaseExternalText(PATH, current, { previous: PREVIOUS, text }, textMerge)).toBeUndefined();
  });

  it("6.2a gives undefined when the editor already holds the new text", () => {
    const text = PREVIOUS.replace("four", "FOUR");
    expect(rebaseExternalText(PATH, text, { previous: PREVIOUS, text }, textMerge)).toBeUndefined();
  });

  it("6.2a gives undefined when the merge equals the editor's text", () => {
    const current = PREVIOUS.replace("two", "TWO");
    expect(rebaseExternalText(PATH, current, { previous: PREVIOUS, text: PREVIOUS }, textMerge)).toBeUndefined();
  });
});

describe("mapping the cursor across an external change", () => {
  const before = "abc XYZ def";
  const after = "abc Q def";

  it("6.2b keeps a cursor before the change", () => {
    expect(mapCursor(before, after, 0)).toBe(0);
    expect(mapCursor(before, after, 2)).toBe(2);
    expect(mapCursor(before, after, 4)).toBe(4);
  });

  it("6.2b shifts a cursor after the change by the length difference", () => {
    expect(mapCursor(before, after, 7)).toBe(5);
    expect(mapCursor(before, after, 9)).toBe(7);
    expect(mapCursor(before, after, before.length)).toBe(after.length);
  });

  it("6.2b shifts a cursor after a longer change forward", () => {
    expect(mapCursor("abc def", "abc XYZW def", 7)).toBe(12);
  });

  it("6.2b puts a cursor inside the change at the end of the inserted text", () => {
    expect(mapCursor(before, after, 5)).toBe(5);
    expect(mapCursor(before, after, 6)).toBe(5);
    expect(mapCursor("abc XY def", "abc 12345 def", 5)).toBe(9);
  });
});
