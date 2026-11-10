/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests what the paper page view reports for a selection: the page and text, capped and with whitespace collapsed, and the
// highlight the selection lies inside; a click is a zero-size selection box.
import { derivePaperSelection, findHighlightAt, type PaperHighlightBox } from "../../../../src/writing/dom/sourceEditor/paperPages";

const HIGHLIGHTS: PaperHighlightBox[] = [
  { id: "wide", position: { x: 0.1, y: 0.2, width: 0.8, height: 0.2 } },
  { id: "line", position: { x: 0.1, y: 0.25, width: 0.4, height: 0.03 } },
  { id: "other", position: { x: 0.1, y: 0.7, width: 0.5, height: 0.05 } },
];

describe("findHighlightAt", () => {
  it("finds the smallest highlight holding the centre of every box", () => {
    expect(findHighlightAt([{ x: 0.12, y: 0.255, width: 0.3, height: 0.02 }], HIGHLIGHTS)).toBe("line");
    expect(findHighlightAt([{ x: 0.12, y: 0.255, width: 0.3, height: 0.02 }, { x: 0.12, y: 0.3, width: 0.6, height: 0.02 }], HIGHLIGHTS)).toBe("wide");
  });

  it("takes a click as a zero-size box", () => {
    expect(findHighlightAt([{ x: 0.3, y: 0.72, width: 0, height: 0 }], HIGHLIGHTS)).toBe("other");
  });

  it("finds none when a box lies outside every highlight, or there are no boxes", () => {
    expect(findHighlightAt([{ x: 0.12, y: 0.255, width: 0.3, height: 0.02 }, { x: 0.1, y: 0.5, width: 0.3, height: 0.02 }], HIGHLIGHTS)).toBeUndefined();
    expect(findHighlightAt([], HIGHLIGHTS)).toBeUndefined();
  });
});

describe("derivePaperSelection", () => {
  it("reports the page and the text with collapsed whitespace", () => {
    expect(derivePaperSelection(3, "  The  model\nfits ", [{ x: 0.1, y: 0.5, width: 0.3, height: 0.02 }], HIGHLIGHTS)).toEqual({ page: 3, text: "The model fits" });
  });

  it("names the highlight the selection lies inside", () => {
    expect(derivePaperSelection(1, "fits", [{ x: 0.2, y: 0.26, width: 0.1, height: 0.02 }], HIGHLIGHTS)).toEqual({ page: 1, text: "fits", highlightId: "line" });
  });

  it("caps the text at 2000 characters", () => {
    expect(derivePaperSelection(1, "a".repeat(2500), [], [])?.text).toHaveLength(2000);
  });

  it("reports nothing for a selection without text", () => {
    expect(derivePaperSelection(1, " \n ", [{ x: 0.2, y: 0.26, width: 0.1, height: 0.02 }], HIGHLIGHTS)).toBeUndefined();
  });
});
