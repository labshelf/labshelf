/** Verifies that a pdflatex preview reuses a precompiled preamble format and rebuilds it only when the preamble changes. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { runLatexBuild, type LatexBuildRequest } from "../../../../src/latex/build/node/index";
import { fakeLogger, type RecordingLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? describe.skip : describe;

interface FormatSetup { request: LatexBuildRequest; logger: RecordingLogger; bin: string; calls: string; args: string; seen: string }

const PREAMBLE = "\\documentclass{report}\n\\usepackage{mystyle}\n";
const BODY = "\\begin{document}\n\\include{chapters/intro}\n\\input{chapters/setup}\n\\end{document}\n";

// The fake etex writes `<output-directory>/<jobname>.fmt`, or fails like XeLaTeX's fontspec when `failing`.
function fakeEtex(calls: string, failing: boolean): string {
  const loop = 'for a in "$@"; do case "$a" in -output-directory=*) D="${a#-output-directory=}";; -jobname=*) J="${a#-jobname=}";; esac; done\n';
  const make = failing ? 'mkdir -p "$D"; echo "! Emergency stop." > "$D/$J.log"; exit 1\n' : 'mkdir -p "$D"; echo fmt > "$D/$J.fmt"\n';
  return `#!/bin/sh\necho etex >> "${calls}"\nprintf '%s\\n' "$@" > "${calls}.etex-args"\necho "$openout_any $openin_any" > "${calls}.etex-env"\n${loop}${make}`;
}

// Each engine run records its arguments, TEXFORMATS and the include-only file it can see.
function fakeEngine(name: string, outDir: string, calls: string, args: string, seen: string): string {
  return `#!/bin/sh\necho ${name} >> "${calls}"\nprintf '%s\\n' "$@" > "${args}"\necho "$openout_any $openin_any" > "${args}.env"\nOUT="${outDir}"\n`
    + `echo "TEXFORMATS=$TEXFORMATS" > "${seen}"; cat "$OUT/labshelf-includeonly.tex" >> "${seen}" 2>/dev/null\n`
    + `echo "%PDF ${name}" > "$OUT/main.pdf"; echo "(main.tex)" > "$OUT/main.log"; echo aux > "$OUT/main.aux"\n`;
}

async function setup(engine: "pdflatex" | "xelatex" = "pdflatex", failing = false): Promise<FormatSetup> {
  const projectFolder = await makeTempDir();
  const outDir = path.join(await makeTempDir(), "build");
  await fs.mkdir(path.join(projectFolder, "chapters"));
  await fs.writeFile(path.join(projectFolder, "main.tex"), PREAMBLE + BODY);
  await fs.writeFile(path.join(projectFolder, "mystyle.sty"), "\\newcommand{\\x}{x}\n");
  await fs.writeFile(path.join(projectFolder, "chapters", "intro.tex"), "x\n");
  await fs.writeFile(path.join(projectFolder, "chapters", "setup.tex"), "y\n");
  const bin = await makeTempDir();
  const [calls, args, seen] = ["calls", "args", "seen"].map((name) => path.join(bin, name)) as [string, string, string];
  await fs.writeFile(path.join(bin, "etex"), fakeEtex(calls, failing), { mode: 0o755 });
  await fs.writeFile(path.join(bin, engine), fakeEngine(engine, outDir, calls, args, seen), { mode: 0o755 });
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "main.aux"), "aux\n");
  await fs.writeFile(path.join(outDir, "main-full.pdf"), "%PDF full\n");
  const logger = fakeLogger();
  const request: LatexBuildRequest = {
    toolchain: { engine, executable: path.join(bin, "latexmk") }, projectFolder, main: "main.tex", outDir, mode: "preview",
    editedFile: "main.tex", editedLine: 1, signal: new AbortController().signal, logger,
  };
  return { request, logger, bin, calls, args, seen };
}

async function lines(file: string): Promise<string[]> {
  return (await fs.readFile(file, "utf8")).trim().split("\n");
}

function formatDir(s: FormatSetup): string {
  return path.join(s.request.outDir, ".labshelf-fmt");
}

async function formats(s: FormatSetup): Promise<string[]> {
  return (await fs.readdir(formatDir(s))).filter((name) => name.endsWith(".fmt"));
}

posixOnly("runLatexBuild preview with a preamble format", () => {
  it("builds the format once for an unchanged preamble and loads it on every preview", async () => {
    const s = await setup();
    await runLatexBuild(s.request);
    await fs.writeFile(path.join(s.request.projectFolder, "main.tex"), PREAMBLE + BODY.replace("\\end", "more\n\\end"));
    const result = await runLatexBuild(s.request);
    expect(result.status).toBe("succeeded");
    expect(await lines(s.calls)).toEqual(["etex", "pdflatex", "pdflatex"]);
    const [format] = await formats(s);
    const args = await lines(s.args);
    expect(args).toContain(`-fmt=${path.basename(format!, ".fmt")}`);
    expect(args.at(-1)).toBe("main.tex");
    expect((await lines(s.seen))[0]).toBe(`TEXFORMATS=${formatDir(s)}${path.delimiter}`);
  });

  it("builds the format and previews without shell escape and with limited file access", async () => {
    const s = await setup();
    await runLatexBuild(s.request);
    expect(await lines(`${s.calls}.etex-args`)).toContain("-no-shell-escape");
    expect(await lines(`${s.calls}.etex-env`)).toEqual(["p p"]);
    expect(await lines(s.args)).toContain("-no-shell-escape");
    expect(await lines(`${s.args}.env`)).toEqual(["p p"]);
  });

  it("rebuilds the format when a local package of the preamble changes and deletes the old one", async () => {
    const s = await setup();
    await runLatexBuild(s.request);
    const [first] = await formats(s);
    await fs.writeFile(path.join(s.request.projectFolder, "mystyle.sty"), "\\newcommand{\\x}{y}\n");
    await runLatexBuild(s.request);
    expect(await lines(s.calls)).toEqual(["etex", "pdflatex", "etex", "pdflatex"]);
    const after = await formats(s);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(first);
  });

  it("previews without a format when the format build fails, logs it and does not retry the same preamble", async () => {
    const s = await setup("pdflatex", true);
    const result = await runLatexBuild(s.request);
    expect(result.status).toBe("succeeded");
    expect(await lines(s.args)).not.toContainEqual(expect.stringMatching(/^-fmt=/));
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ level: "WARN", message: expect.stringContaining("format") }));
    await runLatexBuild(s.request);
    expect(await lines(s.calls)).toEqual(["etex", "pdflatex", "pdflatex"]);
  });

  it("builds no format for xelatex", async () => {
    const s = await setup("xelatex");
    await runLatexBuild(s.request);
    expect(await lines(s.calls)).toEqual(["xelatex"]);
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ level: "INFO", message: expect.stringContaining("format") }));
  });

  it("keeps every chapter in the cached-format preview unless include-only is selected", async () => {
    const s = await setup();
    await runLatexBuild({ ...s.request, editedFile: "chapters/intro.tex" });
    const args = await lines(s.args);
    expect(args.at(-1)).toBe("main.tex");
    expect(args).not.toContain("-jobname=main");
    expect((await lines(s.seen))[1]).toBeUndefined();
    await expect(fs.stat(path.join(s.request.outDir, "labshelf-includeonly.tex"))).rejects.toThrow();
  });

  it("honours the include-only toggle when the edited file is no chapter", async () => {
    const s = await setup();
    await runLatexBuild({ ...s.request, editedFile: "chapters/setup.tex", includeOnly: "chapters/intro" });
    expect((await lines(s.seen))[1]).toBe("\\includeonly{chapters/intro}");
  });

  it("honours the include-only toggle on the command line without a format", async () => {
    const s = await setup("xelatex");
    await runLatexBuild({ ...s.request, includeOnly: "chapters/intro" });
    expect((await lines(s.args)).slice(-2)).toEqual(["-jobname=main", "\\includeonly{chapters/intro}\\input{main.tex}"]);
  });
});
