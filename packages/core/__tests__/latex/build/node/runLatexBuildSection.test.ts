/** Verifies a section preview: the edited section typeset alone on the preamble format, its pages swapped into the last full PDF. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";

import { runLatexBuild, type LatexBuildRequest } from "../../../../src/latex/build/node/index";
import { diffPages } from "../../../../src/writing/helper/node/pages/index";
import { fakeLogger, type RecordingLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? describe.skip : describe;

const MAIN = "\\documentclass{article}\n\\begin{document}\n\\section{One}\none\n\\section{Two}\ntwo\n\\end{document}\n";
const STATES = "section|1|3|main.tex|page=1 section=0\nB|1\nP|1|1|1\nsection|2|5|main.tex|page=2 section=1\nB|2\nP|2|2|2\n";

interface SectionSetup { request: LatexBuildRequest; logger: RecordingLogger; args: string; full: Uint8Array }

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let page = 0; page < pages; page += 1) { doc.addPage([100 + page, 100]); }
  return doc.save();
}

// The section run copies a prepared one-page PDF and logs a warning on the document line holding `two`.
function fakeEngine(outDir: string, args: string, sectionPdf: string): string {
  const fmt = 'for a in "$@"; do case "$a" in -jobname=*) J="${a#-jobname=}";; -output-directory=*) D="${a#-output-directory=}";; esac; done; mkdir -p "$D"; echo fmt > "$D/$J.fmt";';
  return `#!/bin/sh\nprintf '%s\\n' "$@" > "${args}"\nOUT="${outDir}"\n`
    + `case "$*" in *-ini*) ${fmt} exit 0;; esac\n`
    + `case "$*" in *main-section.tex) N=$(grep -n '^two$' "$OUT/main-section.tex" | cut -d: -f1); cp "${sectionPdf}" "$OUT/main-section.pdf"; `
    + `printf "(./main-section.tex\\nLaTeX Warning: Reference \\\`x' on page 1 undefined on input line $N.\\n)\\n" > "$OUT/main-section.log"; exit 0;; esac\n`
    + `cp "${sectionPdf}" "$OUT/main.pdf"; echo "(main.tex)" > "$OUT/main.log"; echo aux > "$OUT/main.aux"\n`;
}

async function setup(): Promise<SectionSetup> {
  const projectFolder = await makeTempDir();
  const outDir = path.join(await makeTempDir(), "build");
  await fs.writeFile(path.join(projectFolder, "main.tex"), MAIN);
  const bin = await makeTempDir();
  const args = path.join(bin, "args");
  const sectionPdf = path.join(bin, "section.pdf");
  await fs.writeFile(sectionPdf, await pdfOf(1));
  for (const name of ["etex", "pdflatex", "latexmk"]) {
    await fs.writeFile(path.join(bin, name), fakeEngine(outDir, args, sectionPdf), { mode: 0o755 });
  }
  const full = await pdfOf(2);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "main.aux"), "\\relax\n\\@writefile{toc}{x}\n\\newlabel{a}{{1}{1}}\n");
  await fs.writeFile(path.join(outDir, "main.lsstate"), STATES);
  await fs.writeFile(path.join(outDir, "main-full.pdf"), full);
  const logger = fakeLogger();
  const request: LatexBuildRequest = {
    toolchain: { engine: "pdflatex", executable: path.join(bin, "latexmk") }, projectFolder, main: "main.tex", outDir, mode: "preview",
    editedFile: "main.tex", signal: new AbortController().signal, logger,
  };
  return { request, logger, args, full };
}

async function lines(file: string): Promise<string[]> {
  return (await fs.readFile(file, "utf8")).trim().split("\n");
}

posixOnly("runLatexBuild section preview", () => {
  it("typesets the edited section alone and swaps its pages into the last full PDF", async () => {
    const s = await setup();
    const result = await runLatexBuild({ ...s.request, editedLine: 6 });
    expect(result.status).toBe("succeeded");
    expect((await lines(s.args)).at(-1)).toBe("main-section.tex");
    const document = await fs.readFile(path.join(s.request.outDir, "main-section.tex"), "utf8");
    expect(document).toMatch(/^%&/);
    expect(document).toContain("\\section{Two}\ntwo\n");
    expect(document).not.toContain("one");
    // The kernel reads the job's own aux at `\begin{document}`, where `\newlabel` still works.
    const aux = await fs.readFile(path.join(s.request.outDir, "main-section.aux"), "utf8");
    expect(aux).toContain("\\newlabel{a}");
    expect(aux).not.toContain("@writefile");
    expect(document).not.toContain("\\input");
    const pdf = await fs.readFile(path.join(s.request.projectFolder, "main.pdf"));
    const before = await diffPages([], s.full);
    const after = await diffPages(before.hashes, pdf);
    expect(after.pageCount).toBe(2);
    expect(after.changed.map((page) => page.index)).toEqual([1]);
  });

  it("reports a section problem on the edited file's own line", async () => {
    const s = await setup();
    const result = await runLatexBuild({ ...s.request, editedLine: 6 });
    expect(result.status === "succeeded" && result.problems).toEqual([
      expect.objectContaining({ severity: "warning", file: path.join(s.request.projectFolder, "main.tex"), line: 6 }),
    ]);
  });

  it("logs why it falls back and runs the preview of the whole document", async () => {
    const s = await setup();
    const result = await runLatexBuild({ ...s.request, editedLine: 2 });
    expect(result.status).toBe("succeeded");
    expect((await lines(s.args)).at(-1)).toBe("main.tex");
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ level: "INFO", message: expect.stringContaining("outside-section") }));
  });

  it("builds the whole document when the preview has no edit, and keeps that PDF as the base", async () => {
    const s = await setup();
    await fs.rm(path.join(s.request.outDir, "main-full.pdf"));
    const result = await runLatexBuild(s.request);
    expect(result.status).toBe("succeeded");
    const built = await fs.readFile(path.join(s.request.outDir, "main.pdf"));
    expect(await fs.readFile(path.join(s.request.outDir, "main-full.pdf"))).toEqual(built);
    expect(await fs.readFile(path.join(s.request.projectFolder, "main.pdf"))).toEqual(built);
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ level: "INFO", message: expect.stringContaining("no-edit") }));
  });

  it("builds the whole document when an edited preview has no full PDF yet", async () => {
    const s = await setup();
    await fs.rm(path.join(s.request.outDir, "main-full.pdf"));
    await runLatexBuild({ ...s.request, editedLine: 6 });
    expect(await fs.stat(path.join(s.request.outDir, "main-full.pdf"))).toBeTruthy();
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ level: "INFO", message: expect.stringContaining("no full PDF yet") }));
  });

  it("keeps the full build's PDF for later section previews", async () => {
    const s = await setup();
    await fs.rm(path.join(s.request.outDir, "main-full.pdf"));
    await runLatexBuild({ ...s.request, mode: "full" });
    expect(await fs.readFile(path.join(s.request.outDir, "main-full.pdf"))).toEqual(await fs.readFile(path.join(s.request.outDir, "main.pdf")));
  });

  it("falls back without publishing a section that changes the page count", async () => {
    const s = await setup();
    await fs.writeFile(path.join(s.request.outDir, "main-full.pdf"), await pdfOf(3));
    const result = await runLatexBuild({ ...s.request, editedLine: 6 });
    expect(result.status).toBe("succeeded");
    expect((await lines(s.args)).at(-1)).toBe("main.tex");
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ message: expect.stringContaining("section-page-count-changed") }));
    await expect(fs.stat(path.join(s.request.outDir, "main.lsstate"))).rejects.toMatchObject({ code: "ENOENT" });
    await runLatexBuild({ ...s.request, editedLine: 4 });
    expect((await lines(s.args)).at(-1)).toBe("main.tex");
    expect(s.logger.logs).toContainEqual(expect.objectContaining({ message: expect.stringContaining("no-full-build") }));
  });
});
