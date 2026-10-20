/** Verifies biber's error messages are picked from its log and its stderr. */
import { biberErrors } from "../../../../src/writing/latex/biber/index";

describe("biberErrors", () => {
  it("returns the ERROR messages of a .blg and of stderr, ignoring INFO and WARN lines", () => {
    const blg = [
      "[0] Config.pm:307> INFO - This is Biber 2.22",
      "[12] Biber.pm:131> WARN - Duplicate entry key",
      "[13] Utils.pm:411> ERROR - Cannot find 'refs.bib'!",
      "ERROR - Data source ../x.bib is outside the project folder",
    ].join("\n");
    expect(biberErrors(blg)).toEqual(["Cannot find 'refs.bib'!", "Data source ../x.bib is outside the project folder"]);
    expect(biberErrors("")).toEqual([]);
  });
});
