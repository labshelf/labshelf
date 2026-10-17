/** Verifies the command lines of both toolchains keep every output file in the build folder. */
import { latexBuildCommand } from "../../../../src/writing/latex/index";

describe("latexBuildCommand", () => {
  it("runs Tectonic with SyncTeX and logs kept in the build folder", () => {
    expect(latexBuildCommand({ engine: "tectonic", executable: "/t/tectonic" }, "main.tex", "/cache/p")).toEqual({
      executable: "/t/tectonic",
      args: ["-X", "compile", "main.tex", "--outdir", "/cache/p", "--synctex", "--keep-logs", "--keep-intermediates"],
    });
  });

  it("runs latexmk with the chosen engine, file:line errors and both output folders", () => {
    const { args } = latexBuildCommand({ engine: "lualatex", executable: "latexmk" }, "paper.tex", "/cache/p");
    expect(args).toEqual(["-lualatex", "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-auxdir=/cache/p", "-outdir=/cache/p", "paper.tex"]);
    expect(latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "m.tex", "/o").args[0]).toBe("-pdf");
    expect(latexBuildCommand({ engine: "xelatex", executable: "latexmk" }, "m.tex", "/o").args[0]).toBe("-xelatex");
  });

  it("passes \\includeonly through latexmk's pretex and forces the rebuild latexmk would skip", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { includeOnly: "ch/two" });
    expect(args).toEqual(["-pdf", "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-auxdir=/o", "-outdir=/o", "-g", "-usepretex=\\includeonly{ch/two}", "main.tex"]);
  });

  it("forces a full rebuild after a partial one without adding the pretex", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { force: true });
    expect(args).toContain("-g");
    expect(args.some((arg) => arg.startsWith("-usepretex"))).toBe(false);
  });

  it("leaves the Tectonic command unchanged, which has no pretex", () => {
    const tectonic = { engine: "tectonic", executable: "/t" } as const;
    expect(latexBuildCommand(tectonic, "m.tex", "/o", { includeOnly: "ch/two" })).toEqual(latexBuildCommand(tectonic, "m.tex", "/o"));
  });
});
