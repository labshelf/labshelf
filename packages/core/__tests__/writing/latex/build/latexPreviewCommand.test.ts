/** Verifies the one-pass preview command: sandboxed engine flags, the include-only job, the preamble format and stopping at the first error. */
import { latexPreviewCommand } from "../../../../src/writing/latex/index";

describe("latexPreviewCommand", () => {
  it("runs the engine once without shell escape into the build folder", () => {
    expect(latexPreviewCommand("pdflatex", "main.tex", "/o")).toEqual({
      executable: "pdflatex",
      args: ["-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-no-shell-escape", "-output-directory=/o", "main.tex"],
      env: { openout_any: "p", openin_any: "p" },
    });
  });

  it("stops at the first error only when asked, with or without a format", () => {
    const format = { name: "main-preamble", searchPath: "/f:" };
    expect(latexPreviewCommand("xelatex", "main.tex", "/o", { haltOnError: true }).args).toContain("-halt-on-error");
    expect(latexPreviewCommand("xelatex", "main.tex", "/o", { haltOnError: true, format }).args).toContain("-halt-on-error");
    expect(latexPreviewCommand("xelatex", "main.tex", "/o", { haltOnError: false }).args).not.toContain("-halt-on-error");
    expect(latexPreviewCommand("xelatex", "main.tex", "/o").args).not.toContain("-halt-on-error");
  });
});
