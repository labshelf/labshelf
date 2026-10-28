// Pins the multiset intersection size used by the similarity measures.
import { countCommon } from "../../src/text/index";

describe("countCommon", () => {
  it("is 0 for disjoint inputs and for an empty side", () => {
    expect(countCommon(["a"], ["b"])).toBe(0);
    expect(countCommon([], ["a"])).toBe(0);
    expect(countCommon(["a"], [])).toBe(0);
    expect(countCommon([], [])).toBe(0);
  });
  it("counts a repeated item only as often as both sides hold it", () => {
    expect(countCommon(["a", "a"], ["a"])).toBe(1);
    expect(countCommon(["a"], ["a", "a"])).toBe(1);
    expect(countCommon(["a", "a", "b"], ["a", "b", "b"])).toBe(2);
  });
  it("is symmetric", () => {
    const left = ["x", "y", "y", "z"];
    const right = ["y", "z", "z", "w", "y", "y"];
    expect(countCommon(left, right)).toBe(countCommon(right, left));
  });
});
