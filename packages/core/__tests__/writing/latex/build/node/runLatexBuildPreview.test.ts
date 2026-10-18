/** Verifies a preview LaTeX build: one engine pass, only the edited chapter, a full build when none ran yet. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { runLatexBuild, type LatexBuildRequest } from "../../../../../src/writing/latex/build/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? describe.skip : describe;

interface PreviewSetup { request: LatexBuildRequest; calls: string; args: string }

// Each fake program appends its name to `calls`, writes its arguments to `args` and produces a PDF and a log.
function fakeProgram(name: string, outDir: string, calls: string, args: string): string {
  return `#!/bin/sh\necho ${name} >> "${calls}"\nprintf '%s\\n' "$@" > "${args}"\nOUT="${outDir}"\n`
    + `echo "%PDF ${name}" > "$OUT/main.pdf"; echo "(main.tex)" > "$OUT/main.log"; echo aux > "$OUT/main.aux"; echo fdb > "$OUT/main.fdb_latexmk"\n`;
}

async function setup(): Promise<PreviewSetup> {
  const projectFolder = await makeTempDir();
  const outDir = path.join(await makeTempDir(), "build");
  await fs.mkdir(path.join(projectFolder, "chapters"));
  await fs.writeFile(path.join(projectFolder, "main.tex"), "\\documentclass{book}\n\\begin{document}\n\\include{chapters/intro}\n\\input{chapters/setup}\n\\end{document}\n");
  await fs.writeFile(path.join(projectFolder, "chapters", "intro.tex"), "x\n");
  await fs.writeFile(path.join(projectFolder, "chapters", "setup.tex"), "y\n");
  const bin = await makeTempDir();
  const calls = path.join(bin, "calls");
  const args = path.join(bin, "args");
  await fs.writeFile(path.join(bin, "latexmk"), fakeProgram("latexmk", outDir, calls, args), { mode: 0o755 });
  await fs.writeFile(path.join(bin, "xelatex"), fakeProgram("xelatex", outDir, calls, args), { mode: 0o755 });
  const request: LatexBuildRequest = {
    toolchain: { engine: "xelatex", executable: path.join(bin, "latexmk") }, projectFolder, main: "main.tex", outDir,
    signal: new AbortController().signal, logger: fakeLogger(),
  };
  return { request, calls, args };
}

async function lines(file: string): Promise<string[]> {
  return (await fs.readFile(file, "utf8")).trim().split("\n");
}

async function withPriorBuild(setup: PreviewSetup): Promise<void> {
  await fs.mkdir(setup.request.outDir, { recursive: true });
  await fs.writeFile(path.join(setup.request.outDir, "main.aux"), "aux\n");
}

posixOnly("runLatexBuild preview", () => {
  it("runs the engine once without latexmk and removes latexmk's database", async () => {
    const s = await setup();
    await withPriorBuild(s);
    const result = await runLatexBuild({ ...s.request, mode: "preview" });
    expect(result).toEqual({ status: "succeeded", pdf: path.join(s.request.projectFolder, "main.pdf"), problems: [] });
    expect(await lines(s.calls)).toEqual(["xelatex"]);
    expect(await lines(s.args)).toEqual(["-interaction=nonstopmode", "-file-line-error", "-synctex=1", `-output-directory=${s.request.outDir}`, "main.tex"]);
    await expect(fs.stat(path.join(s.request.outDir, "main.fdb_latexmk"))).rejects.toThrow();
    expect(await fs.readFile(path.join(s.request.outDir, "main.aux"), "utf8")).toBe("aux\n");
  });

  it("typesets only the edited \\include chapter without changing the source", async () => {
    const s = await setup();
    await withPriorBuild(s);
    await runLatexBuild({ ...s.request, mode: "preview", editedFile: "chapters/intro.tex" });
    expect(await lines(s.calls)).toEqual(["xelatex"]);
    expect((await lines(s.args)).slice(-2)).toEqual(["-jobname=main", "\\includeonly{chapters/intro}\\input{main.tex}"]);
  });

  it("compiles main as is when the edited file is \\input, not \\include", async () => {
    const s = await setup();
    await withPriorBuild(s);
    await runLatexBuild({ ...s.request, mode: "preview", editedFile: "chapters/setup.tex" });
    expect((await lines(s.args)).at(-1)).toBe("main.tex");
  });

  it("runs a full latexmk build when no build has written the .aux yet", async () => {
    const s = await setup();
    await runLatexBuild({ ...s.request, mode: "preview", editedFile: "chapters/intro.tex" });
    expect(await lines(s.calls)).toEqual(["latexmk"]);
    expect(await fs.readFile(path.join(s.request.outDir, "main.fdb_latexmk"), "utf8")).toBe("fdb\n");
  });

  it("keeps a full build on latexmk", async () => {
    const s = await setup();
    await withPriorBuild(s);
    await runLatexBuild({ ...s.request, mode: "full", editedFile: "chapters/intro.tex" });
    expect(await lines(s.calls)).toEqual(["latexmk"]);
    expect(await lines(s.args)).not.toContain("-jobname=main");
  });
});
