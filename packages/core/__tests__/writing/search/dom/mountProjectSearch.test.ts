// Tests which result Enter and Shift+Enter open next.
import { stepResult } from "../../../../src/writing/search/dom/mountProjectSearch";

describe("stepResult", () => {
  it("opens the first result going forward and the last going back when none is open", () => {
    expect(stepResult(-1, 3, 1)).toBe(0);
    expect(stepResult(-1, 3, -1)).toBe(2);
  });

  it("moves one result at a time and wraps at both ends", () => {
    expect(stepResult(0, 3, 1)).toBe(1);
    expect(stepResult(2, 3, 1)).toBe(0);
    expect(stepResult(0, 3, -1)).toBe(2);
  });

  it("starts over when the open result is past a shorter list", () => {
    expect(stepResult(5, 3, 1)).toBe(0);
  });

  it("returns -1 when there are no results", () => {
    expect(stepResult(-1, 0, 1)).toBe(-1);
    expect(stepResult(2, 0, -1)).toBe(-1);
  });
});
