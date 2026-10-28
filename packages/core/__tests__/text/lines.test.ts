// Pins the offset-to-line helpers: line starts, the line holding an offset, one-based line numbers and line ends.
import { deriveLineOffsets, findLineOfOffset, lineAt, lineEnd } from "../../src/text/index";

describe("deriveLineOffsets", () => {
  it("lists where each line starts", () => {
    expect(deriveLineOffsets("")).toEqual([0]);
    expect(deriveLineOffsets("ab\ncd\n")).toEqual([0, 3, 6]);
  });
});

describe("findLineOfOffset", () => {
  it("returns the last line start at or before the offset", () => {
    const starts = deriveLineOffsets("ab\ncd\nef");
    expect(findLineOfOffset(starts, 0)).toBe(0);
    expect(findLineOfOffset(starts, 2)).toBe(0);
    expect(findLineOfOffset(starts, 3)).toBe(1);
    expect(findLineOfOffset(starts, 100)).toBe(2);
  });
});

describe("lineAt", () => {
  it("numbers lines from one", () => {
    expect(lineAt("ab\ncd", 0)).toBe(1);
    expect(lineAt("ab\ncd", 2)).toBe(1);
    expect(lineAt("ab\ncd", 3)).toBe(2);
  });
});

describe("lineEnd", () => {
  it("is the offset just after the next newline at or after from", () => {
    expect(lineEnd("ab\ncd", 0)).toBe(3);
    expect(lineEnd("ab\ncd", 2)).toBe(3);
    expect(lineEnd("ab\ncd", 3)).toBe(5);
  });
  it("is the text length when no newline follows", () => {
    expect(lineEnd("abc", 1)).toBe(3);
  });
});
