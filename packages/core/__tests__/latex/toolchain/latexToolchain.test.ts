/** Verifies the label shown for each LaTeX engine. */
import { engineLabel } from "../../../src/latex/toolchain/index";

describe("engineLabel", () => {
  it("names every engine as users see it", () => {
    expect(engineLabel("xelatex")).toBe("XeLaTeX");
    expect(engineLabel("pdflatex")).toBe("pdfLaTeX");
    expect(engineLabel("lualatex")).toBe("LuaLaTeX");
  });
});
