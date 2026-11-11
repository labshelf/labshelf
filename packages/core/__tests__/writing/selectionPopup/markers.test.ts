/** Verifies that every selection popup marker pair wraps and unwraps, and that the bold and italic wrap is unchanged. */
import { deriveMarkerWrap, deriveSelectionWrap } from "../../../src/writing/snippets";
import { SELECTION_POPUP_MARKERS } from "../../../src/writing/selectionPopup/index";

describe("selection popup markers", () => {
  for (const language of ["latex", "typst"] as const) {
    for (const [id, markers] of Object.entries(SELECTION_POPUP_MARKERS[language])) {
      it(`${language} ${id} wraps and unwraps`, () => {
        const wrapped = deriveMarkerWrap(markers, "word").text;
        expect(wrapped).toBe(`${markers.open}word${markers.close}`);
        expect(deriveMarkerWrap(markers, wrapped)).toEqual({ text: "word" });
        expect(deriveMarkerWrap(markers, "")).toEqual({ text: markers.open + markers.close, cursor: markers.open.length });
      });
    }
  }

  it("keeps deriveSelectionWrap's behaviour", () => {
    expect(deriveSelectionWrap("latex", "bold", "\\textbf{a}")).toEqual({ text: "a" });
    expect(deriveSelectionWrap("latex", "bold", "\\textbf{a} and \\textbf{b}")).toEqual({ text: "\\textbf{\\textbf{a} and \\textbf{b}}" });
    expect(deriveSelectionWrap("typst", "italic", "_a_ _b_")).toEqual({ text: "__a_ _b__" });
  });
});
