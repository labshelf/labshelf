// Pins line similarity for merge-base selection across inserted and repeated lines.
import { lineSimilarity } from "../../../src/writing/text/index";

describe("lineSimilarity", () => {
  it("ignores line endings and the final newline", () => {
    expect(lineSimilarity("a\r\nb\r\n", "a\nb")).toBe(1);
  });
  it("counts equal lines across insertions over the larger line count", () => {
    expect(lineSimilarity("a\nb\nc", "intro\na\nb\nc")).toBe(0.75);
  });
  it("counts repeated lines only as often as both texts contain them", () => {
    expect(lineSimilarity("a\na\nb", "a\nb\nb")).toBeCloseTo(2 / 3);
  });
  it("compares empty texts without dividing by zero", () => {
    expect(lineSimilarity("", "")).toBe(1);
    expect(lineSimilarity("", "a")).toBe(0);
  });
});
