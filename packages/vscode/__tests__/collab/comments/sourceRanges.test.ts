// Tests which text a new comment thread anchors to, from an editor selection and from a review note's SyncTeX line.
import { createEditorCommentRange, deriveOffset, derivePosition, findSourceCommentRange } from "../../../src/collab/comments/sourceRanges";

const slice = (text: string, range: { start: number; end: number } | undefined) => range && text.slice(range.start, range.end);

describe("comment source ranges", () => {
  it("maps line positions to offsets and back, a CRLF line ending before its \\r", () => {
    const text = "one\r\ntwo\nthree";
    expect(deriveOffset(text, { line: 1, character: 1 })).toBe(6);
    expect(deriveOffset(text, { line: 0, character: 99 })).toBe(3);
    expect(derivePosition(text, 6)).toEqual({ line: 1, character: 1 });
    expect(derivePosition(text, text.length)).toEqual({ line: 2, character: 5 });
  });

  it("anchors an editor thread to its selection, or to its whole lines without their indent when empty", () => {
    const text = "\\begin{x}\n  A claim here.\n\n";
    expect(slice(text, createEditorCommentRange(text, { line: 1, character: 4 }, { line: 1, character: 9 }))).toBe("claim");
    expect(slice(text, createEditorCommentRange(text, { line: 1, character: 0 }, { line: 1, character: 0 }))).toBe("A claim here.");
    expect(createEditorCommentRange(text, { line: 2, character: 0 }, { line: 2, character: 0 })).toBeUndefined();
  });

  it("anchors a review note to its quote on the nearest line around the SyncTeX line, else to that line", () => {
    const text = "First line.\nThe quoted words are here.\nThird line.\nFourth.";
    expect(slice(text, findSourceCommentRange(text, 2, "quoted words"))).toBe("quoted words");
    expect(findSourceCommentRange(text, 4, "quoted words")).toEqual({ start: 16, end: 28 });
    expect(slice(text, findSourceCommentRange(text, 3, "not in the source"))).toBe("Third line.");
    expect(slice(text, findSourceCommentRange(text, 1, ""))).toBe("First line.");
    expect(findSourceCommentRange(text, 9, "x")).toBeUndefined();
  });
});
