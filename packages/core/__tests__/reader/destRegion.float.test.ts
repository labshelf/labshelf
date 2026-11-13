// Pins findFloatCaptionNear: the caption a float region is found by, on one and two columns.
import { findFloatCaptionNear } from "../../src/reader/destRegion";
import type { TextLine } from "../../src/reader/textLines";
import { single, twoCol, line, body, LEFT, RIGHT } from "./destRegionHarness";

describe("findFloatCaptionNear", () => {
  const caps = (): TextLine[] => [
    ...body(750, 3),
    line("Figure 1: The first figure", 600),
    ...body(580, 3),
    line("Figure 2: The second figure", 300),
    line("Table 1: A table of values", 200),
    ...body(180, 3),
  ];
  const figure = (label: string | null) => ({ floatKind: "figure" as const, label });

  it("1.1h picks the caption whose label matches, even when another figure caption is closer", () => {
    const lines = caps();
    const hit = findFloatCaptionNear(lines, single, figure("1"), { x: 100, y: 310 });
    expect(hit).toMatchObject({ kind: "figure", label: "1", lineIndex: 3 });
  });

  it("1.1h falls back to the label without its sub-figure letter", () => {
    const hit = findFloatCaptionNear(caps(), single, figure("2a"), { x: 100, y: 650 });
    expect(hit).toMatchObject({ kind: "figure", label: "2" });
  });

  it("1.1h ignores captions of another kind when matching the label", () => {
    const hit = findFloatCaptionNear(caps(), single, { floatKind: "table", label: "1" }, { x: 100, y: 650 });
    expect(hit).toMatchObject({ kind: "table", label: "1" });
  });

  it("1.1h without a label match picks the caption at or below the destination with the greatest y", () => {
    const hit = findFloatCaptionNear(caps(), single, figure("9"), { x: 100, y: 650 });
    expect(hit).toMatchObject({ kind: "figure", label: "1" });
    const lower = findFloatCaptionNear(caps(), single, figure(null), { x: 100, y: 350 });
    expect(lower).toMatchObject({ kind: "figure", label: "2" });
  });

  it("1.1h picks the nearest caption when none lies at or below the destination", () => {
    const hit = findFloatCaptionNear(caps(), single, figure(null), { x: 100, y: 100 });
    expect(hit).toMatchObject({ kind: "figure", label: "2" });
  });

  it("1.1h returns null when the page has no caption of that kind", () => {
    const lines = [...body(750, 3), line("Table 1: A table of values", 400), ...body(380, 3)];
    expect(findFloatCaptionNear(lines, single, figure(null), { x: 100, y: 400 })).toBeNull();
    expect(findFloatCaptionNear([], single, figure("1"), { x: 100, y: 400 })).toBeNull();
  });

  describe("on a two-column page", () => {
    const lines = (): TextLine[] => [
      ...body(750, 3, LEFT),
      line("Figure 1: Left caption", 400, LEFT),
      ...body(380, 3, LEFT),
      ...body(750, 3, RIGHT),
      line("Figure 2: Right caption", 500, RIGHT),
      ...body(480, 3, RIGHT),
    ];

    it("1.1h keeps only captions in the destination's right column", () => {
      // a mixed search would take the left caption (y 400 <= 452); the right column has only one above
      const hit = findFloatCaptionNear(lines(), twoCol, figure(null), { x: 400, y: 450 });
      expect(hit).toMatchObject({ kind: "figure", label: "2" });
    });

    it("1.1h keeps only captions in the destination's left column", () => {
      // a mixed search would take the right caption (y 500, the greatest at or below 522)
      const hit = findFloatCaptionNear(lines(), twoCol, figure(null), { x: 150, y: 520 });
      expect(hit).toMatchObject({ kind: "figure", label: "1" });
    });

    it("1.1h still returns a label match from the other column", () => {
      const hit = findFloatCaptionNear(lines(), twoCol, figure("1"), { x: 400, y: 450 });
      expect(hit).toMatchObject({ kind: "figure", label: "1" });
    });
  });
});

