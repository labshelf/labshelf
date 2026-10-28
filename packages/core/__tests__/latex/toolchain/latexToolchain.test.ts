/** Verifies the label shown for each LaTeX engine. */
import { formatEngineLabel } from "../../../src/latex/toolchain";

describe("formatEngineLabel", () => {
  it("names every engine as users see it", () => {
    expect(formatEngineLabel("xelatex")).toBe("XeLaTeX");
    expect(formatEngineLabel("pdflatex")).toBe("pdfLaTeX");
    expect(formatEngineLabel("lualatex")).toBe("LuaLaTeX");
  });
});
