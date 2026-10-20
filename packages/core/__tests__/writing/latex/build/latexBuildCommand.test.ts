/** Verifies the command line of each engine keeps every output file in the build folder. */
import { latexBuildCommand } from "../../../../src/writing/latex/index";

describe("latexBuildCommand", () => {
  it("runs latexmk with the chosen engine, file:line errors and both output folders", () => {
    const { args } = latexBuildCommand({ engine: "lualatex", executable: "latexmk" }, "paper.tex", "/cache/p");
    expect(args).toEqual([
      "-norc", "-lualatex", "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-auxdir=/cache/p", "-outdir=/cache/p",
      "-e", "$lualatex = 'lualatex -no-shell-escape -jobname=%R %O %P';", "paper.tex",
    ]);
    expect(latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "m.tex", "/o").args[1]).toBe("-pdf");
    expect(latexBuildCommand({ engine: "xelatex", executable: "latexmk" }, "m.tex", "/o").args[1]).toBe("-xelatex");
  });

  it("passes \\includeonly through latexmk's pretex and forces the rebuild latexmk would skip", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { includeOnly: "ch/two" });
    expect(args).toEqual([
      "-norc", "-pdf", "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-auxdir=/o", "-outdir=/o",
      "-e", "$pdflatex = 'pdflatex -no-shell-escape -jobname=%R %O %P';", "-g", "-pretex=\\includeonly{ch/two}", "main.tex",
    ]);
  });

  it("forces a full rebuild after a partial one without adding the pretex", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { force: true });
    expect(args).toContain("-g");
    expect(args.some((arg) => arg.startsWith("-pretex") || arg.startsWith("-usepretex"))).toBe(false);
  });

  it("loads the section state package before the document and before \\includeonly when asked", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { includeOnly: "ch/two", capturesSectionState: true });
    expect(args).toContain("-pretex=\\RequirePackage{labshelf-state}\\includeonly{ch/two}");
    expect(latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "m.tex", "/o", { capturesSectionState: true }).args)
      .toContain("-pretex=\\RequirePackage{labshelf-state}");
  });

  it("runs biber through the host's command only when the host gives one", () => {
    const toolchain = { engine: "pdflatex" as const, executable: "latexmk" };
    expect(latexBuildCommand(toolchain, "m.tex", "/o").args.some((arg) => arg.startsWith("$biber"))).toBe(false);
    const { args } = latexBuildCommand(toolchain, "m.tex", "/o", { biber: { command: ["/opt/LabShelf Helper"], root: "/p" } });
    expect(args.slice(-3)).toEqual(["-e", "$biber = '\\'/opt/LabShelf Helper\\' \\'--biber\\' \\'--root\\' \\'/p\\' %O %S';", "m.tex"]);
  });

  it("ignores every latexmkrc, which latexmk would run as Perl", () => {
    expect(latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "m.tex", "/o").args[0]).toBe("-norc");
  });

  it("runs every engine without shell escape and with TeX file access limited to the project and output folders", () => {
    for (const engine of ["pdflatex", "xelatex", "lualatex"] as const) {
      const { args, env } = latexBuildCommand({ engine, executable: "latexmk" }, "m.tex", "/o");
      expect(args).toContain(`$${engine} = '${engine} -no-shell-escape -jobname=%R %O %P';`);
      expect(env).toEqual({ openout_any: "p", openin_any: "p" });
    }
  });
});
