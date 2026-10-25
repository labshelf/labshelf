/** Verifies the LaTeX package a full build loads records each heading's landing page at shipout. */
import { createSectionBuildStatePackage } from "../../../../src/latex/build/section/index";

describe("createSectionBuildStatePackage", () => {
  it("writes the landing record with a delayed write that expands the shipped page", () => {
    const text = createSectionBuildStatePackage();
    expect(text).toContain("\\write\\labshelf@state{P|\\the\\labshelf@index|\\noexpand\\the\\noexpand\\ReadonlyShipoutCounter|\\noexpand\\the\\noexpand\\c@page}");
    expect(text).toContain("\\AddToHook{cmd/@xsect/before}{\\labshelf@landsection}");
    expect(text).not.toContain("/after}");
  });
});
