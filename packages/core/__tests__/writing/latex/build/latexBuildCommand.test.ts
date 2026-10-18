/** Verifies the command line of each engine keeps every output file in the build folder. */
import { latexBuildCommand } from "../../../../src/writing/latex/index";

describe("latexBuildCommand", () => {
  it("runs latexmk with the chosen engine, file:line errors and both output folders", () => {
    const { args } = latexBuildCommand({ engine: "lualatex", executable: "latexmk" }, "paper.tex", "/cache/p");
    expect(args).toEqual([
      "-norc", "-lualatex", "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-auxdir=/cache/p", "-outdir=/cache/p",
      "-e", "$lualatex = 'lualatex -no-shell-escape %O %S';", "paper.tex",
    ]);
    expect(latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "m.tex", "/o").args[1]).toBe("-pdf");
    expect(latexBuildCommand({ engine: "xelatex", executable: "latexmk" }, "m.tex", "/o").args[1]).toBe("-xelatex");
  });

  it("passes \\includeonly through latexmk's pretex and forces the rebuild latexmk would skip", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { includeOnly: "ch/two" });
    expect(args).toEqual([
      "-norc", "-pdf", "-interaction=nonstopmode", "-file-line-error", "-synctex=1", "-auxdir=/o", "-outdir=/o",
      "-e", "$pdflatex = 'pdflatex -no-shell-escape %O %S';", "-g", "-usepretex=\\includeonly{ch/two}", "main.tex",
    ]);
  });

  it("forces a full rebuild after a partial one without adding the pretex", () => {
    const { args } = latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "main.tex", "/o", { force: true });
    expect(args).toContain("-g");
    expect(args.some((arg) => arg.startsWith("-usepretex"))).toBe(false);
  });

  it("ignores every latexmkrc, which latexmk would run as Perl", () => {
    expect(latexBuildCommand({ engine: "pdflatex", executable: "latexmk" }, "m.tex", "/o").args[0]).toBe("-norc");
  });

  it("runs every engine without shell escape and with TeX file access limited to the project and output folders", () => {
    for (const engine of ["pdflatex", "xelatex", "lualatex"] as const) {
      const { args, env } = latexBuildCommand({ engine, executable: "latexmk" }, "m.tex", "/o");
      expect(args).toContain(`$${engine} = '${engine} -no-shell-escape %O %S';`);
      expect(env).toEqual({ openout_any: "p", openin_any: "p" });
    }
  });
});
