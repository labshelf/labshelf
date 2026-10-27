// Pins line similarity for merge-base selection across inserted and repeated lines.
import { deriveLineSimilarity } from "../../../src/writing/text/index";

describe("deriveLineSimilarity", () => {
  it("ignores line endings and the final newline", () => {
    expect(deriveLineSimilarity("a\r\nb\r\n", "a\nb")).toBe(1);
  });
  it("counts equal lines across insertions over the larger line count", () => {
    expect(deriveLineSimilarity("a\nb\nc", "intro\na\nb\nc")).toBe(0.75);
  });
  it("counts repeated lines only as often as both texts contain them", () => {
    expect(deriveLineSimilarity("a\na\nb", "a\nb\nb")).toBeCloseTo(2 / 3);
  });
  it("compares empty texts without dividing by zero", () => {
    expect(deriveLineSimilarity("", "")).toBe(1);
    expect(deriveLineSimilarity("", "a")).toBe(0);
  });
});
