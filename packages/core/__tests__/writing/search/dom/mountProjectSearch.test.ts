// Tests which result Enter and Shift+Enter open next.
import { deriveSteppedMatch } from "../../../../src/writing/search/dom/mountProjectSearch";

describe("deriveSteppedMatch", () => {
  it("opens the first result going forward and the last going back when none is open", () => {
    expect(deriveSteppedMatch(-1, 3, 1)).toBe(0);
    expect(deriveSteppedMatch(-1, 3, -1)).toBe(2);
  });

  it("moves one result at a time and wraps at both ends", () => {
    expect(deriveSteppedMatch(0, 3, 1)).toBe(1);
    expect(deriveSteppedMatch(2, 3, 1)).toBe(0);
    expect(deriveSteppedMatch(0, 3, -1)).toBe(2);
  });

  it("starts over when the open result is past a shorter list", () => {
    expect(deriveSteppedMatch(5, 3, 1)).toBe(0);
  });

  it("returns -1 when there are no results", () => {
    expect(deriveSteppedMatch(-1, 0, 1)).toBe(-1);
    expect(deriveSteppedMatch(2, 0, -1)).toBe(-1);
  });
});
