/** Verifies a LaTeX build against fake toolchains: PDF only on success, problems located in the project, cancellation. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { deriveBuildRootFolder } from "../../../../src/writing/project/buildRoot/index";
import { runLatexBuild, type LatexBuildRequest } from "../../../../src/latex/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? describe.skip : describe;

function writesLog(lines: string[]): string {
  return `cat > "$OUT/main.log" <<'LOG'\n${lines.join("\n")}\nLOG\nexit 1`;
}

async function setup(script: string): Promise<LatexBuildRequest> {
  const projectFolder = await makeTempDir();
  const outDir = path.join(await makeTempDir(), "build");
  await fs.mkdir(path.join(projectFolder, "chapters"));
  await fs.writeFile(path.join(projectFolder, "main.tex"), "\\documentclass{article}\n");
  await fs.writeFile(path.join(projectFolder, "chapters", "intro.tex"), "x\n");
  const executable = path.join(await makeTempDir(), "latexmk");
  await fs.writeFile(executable, `#!/bin/sh\nOUT="${outDir}"\n${script}\n`, { mode: 0o755 });
  return { toolchain: { engine: "xelatex", executable }, projectFolder, main: "main.tex", outDir, signal: new AbortController().signal, logger: fakeLogger() };
}

posixOnly("runLatexBuild", () => {
  it("copies the PDF next to the main file on success and leaves the rest in the build folder", async () => {
    const request = await setup('echo "%PDF-1.5 built" > "$OUT/main.pdf"; echo "(main.tex)" > "$OUT/main.log"; echo aux > "$OUT/main.aux"');
    const result = await runLatexBuild(request);
    expect(result).toEqual({ status: "succeeded", pdf: path.join(request.projectFolder, "main.pdf"), problems: [] });
    expect(await fs.readFile(path.join(request.projectFolder, "main.pdf"), "utf8")).toBe("%PDF-1.5 built\n");
    expect((await fs.readdir(request.projectFolder)).sort()).toEqual(["chapters", "main.pdf", "main.tex"]);
  });

  it("runs latexmk with TeX file access limited to the project and output folders", async () => {
    const request = await setup('echo "$openout_any $openin_any" > "$OUT/env"; echo "%PDF" > "$OUT/main.pdf"');
    await runLatexBuild(request);
    expect(await fs.readFile(path.join(request.outDir, "env"), "utf8")).toBe("p p\n");
  });

  it("keeps the previous PDF on failure and places the error in the \\input file the log names", async () => {
    const request = await setup(writesLog(["(main.tex (chapters/intro.tex", "! Undefined control sequence.", "l.3 Another \\badmacro"]));
    await fs.writeFile(path.join(request.projectFolder, "main.pdf"), "old");
    const result = await runLatexBuild(request);
    expect(result).toEqual({ status: "failed", problems: [expect.objectContaining({
      severity: "error", message: "Unknown command \\badmacro.", file: path.join(request.projectFolder, "chapters", "intro.tex"), line: 3,
    })] });
    expect(await fs.readFile(path.join(request.projectFolder, "main.pdf"), "utf8")).toBe("old");
  });

  it("puts a problem from a package file on the main file, named after the package", async () => {
    const request = await setup(writesLog(["(main.tex (fontspec.sty", "! Undefined control sequence.", "l.9 \\oops"]));
    const result = await runLatexBuild(request);
    expect(result).toMatchObject({ status: "failed", problems: [{ message: "fontspec.sty: Unknown command \\oops.", file: path.join(request.projectFolder, "main.tex") }] });
    expect((result as { problems: { line?: number }[] }).problems[0]!.line).toBeUndefined();
  });

  it("builds same-named roots in different folders into their own build folders and puts each PDF next to its root", async () => {
    const projectFolder = await makeTempDir();
    const buildDir = path.join(await makeTempDir(), "build");
    const executable = path.join(await makeTempDir(), "latexmk");
    await fs.writeFile(executable, '#!/bin/sh\nfor a in "$@"; do case "$a" in -outdir=*) OUT="${a#-outdir=}";; esac; done\nmkdir -p "$OUT"\necho "%PDF $(basename "$OUT")" > "$OUT/main.pdf"\n', { mode: 0o755 });
    for (const root of ["a/main.tex", "b/main.tex"]) {
      await fs.mkdir(path.join(projectFolder, path.dirname(root)), { recursive: true });
      await fs.writeFile(path.join(projectFolder, root), "x\n");
      const outDir = path.join(buildDir, deriveBuildRootFolder(root));
      const result = await runLatexBuild({ toolchain: { engine: "xelatex", executable }, projectFolder, main: root, outDir, signal: new AbortController().signal, logger: fakeLogger() });
      expect(result).toMatchObject({ status: "succeeded", pdf: path.join(projectFolder, root.replace(".tex", ".pdf")) });
    }
    expect(await fs.readFile(path.join(projectFolder, "a", "main.pdf"), "utf8")).toContain("a__main.tex");
    expect(await fs.readFile(path.join(projectFolder, "b", "main.pdf"), "utf8")).toContain("b__main.tex");
  });

  it("reports the engine and the last output line when the log names no error", async () => {
    const request = await setup('echo "latexmk: out of memory" >&2; exit 3');
    expect(await runLatexBuild(request)).toMatchObject({
      status: "failed", problems: [{ severity: "error", message: "XeLaTeX stopped with exit code 3: latexmk: out of memory" }],
    });
  });

  it("drops latexmk's database after a failed full build so the next one reruns the failed step", async () => {
    const request = await setup('echo "biber gave an error" > "$OUT/main.fdb_latexmk"; exit 12');
    expect(await runLatexBuild(request)).toMatchObject({ status: "failed" });
    await expect(fs.stat(path.join(request.outDir, "main.fdb_latexmk"))).rejects.toThrow();
  });

  it("reports a toolchain that cannot be started", async () => {
    const request = await setup("");
    request.toolchain = { engine: "xelatex", executable: path.join(request.outDir, "missing") };
    const result = await runLatexBuild(request);
    expect(result).toMatchObject({ status: "failed", problems: [{ severity: "error", file: path.join(request.projectFolder, "main.tex") }] });
    expect((result as { problems: { message: string }[] }).problems[0]!.message).toContain("Could not start");
  });

  it("stops the process tree when cancelled and writes no PDF", async () => {
    const request = await setup('sleep 30 & wait; echo "%PDF" > "$OUT/main.pdf"');
    const controller = new AbortController();
    const started = Date.now();
    const running = runLatexBuild({ ...request, signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    expect(await running).toEqual({ status: "cancelled" });
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(fs.stat(path.join(request.projectFolder, "main.pdf"))).rejects.toThrow();
  });
});
