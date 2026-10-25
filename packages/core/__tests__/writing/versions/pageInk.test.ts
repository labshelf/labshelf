// Tests reducing RGBA pixels to ink and darkness.
import { inkMapFromRgba } from "../../../src/writing/versions/pageInk";

describe("inkMapFromRgba", () => {
  it("marks dark pixels as ink with their darkness and leaves white and faint tints blank", () => {
    const rgba = new Uint8Array([
      0, 0, 0, 255,
      255, 255, 255, 255,
      100, 100, 100, 255,
      220, 220, 220, 255,
    ]);
    const map = inkMapFromRgba(rgba, 4, 1);
    expect(map.width).toBe(4);
    expect(map.height).toBe(1);
    expect(Array.from(map.ink)).toEqual([1, 0, 1, 0]);
    expect(Array.from(map.dark)).toEqual([255, 0, 155, 35]);
  });

  it("judges luminance, so yellow is blank and blue is ink", () => {
    const map = inkMapFromRgba(new Uint8ClampedArray([255, 255, 0, 255, 0, 0, 255, 255]), 2, 1);
    expect(Array.from(map.ink)).toEqual([0, 1]);
  });

  it("returns empty maps for an empty page", () => {
    expect(inkMapFromRgba(new Uint8Array(0), 0, 0).ink).toHaveLength(0);
  });
});
