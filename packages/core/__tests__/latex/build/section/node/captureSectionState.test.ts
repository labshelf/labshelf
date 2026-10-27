/** Verifies with a real TeX that a full build records the counters before each section and the page it lands on, without touching the project. */
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { runLatexBuild } from "../../../../../src/latex/node/index";
import { readSectionBuildStates } from "../../../../../src/latex/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

const latexmk = spawnSync("which", ["latexmk"], { encoding: "utf8" }).stdout.trim();
const pdflatex = spawnSync("which", ["pdflatex"], { encoding: "utf8" }).stdout.trim();
const withTex = latexmk !== "" && pdflatex !== "" && process.platform !== "win32";
if (!withTex) { console.warn("captureSectionState: latexmk or pdflatex is not on PATH; the real TeX run is skipped"); }

const MAIN = "\\documentclass{article}\n\\begin{document}\n\\section{One}\n\\begin{equation}a\\end{equation}\n"
  + "\\begin{figure}[h]x\\caption{c}\\end{figure}\n\\newpage\n\\input{chapters/two}\n\\newpage\n\\section{Three}\n\\end{document}\n";
const TWO = "\\section{Two}\n\\begin{equation}b\\end{equation}\n";
// The rule leaves too little room for a heading, so TeX breaks the page at `\@secpenalty` and `Two` lands on page 2.
const PUSHED = "\\documentclass{article}\n\\begin{document}\n\\section{One}\nx\\par\\rule{1pt}{0.93\\textheight}\n"
  + "\\section{Two}\\label{two}\ny\n\\end{document}\n";

(withTex ? describe : describe.skip)("section state capture", () => {
  it("writes one state per section with the counters before it and its absolute page", async () => {
    const projectFolder = await makeTempDir();
    const outDir = path.join(await makeTempDir(), "build");
    await fs.mkdir(path.join(projectFolder, "chapters"));
    await fs.writeFile(path.join(projectFolder, "main.tex"), MAIN);
    await fs.writeFile(path.join(projectFolder, "chapters", "two.tex"), TWO);
    const logger = fakeLogger();
    const result = await runLatexBuild({
      toolchain: { engine: "pdflatex", executable: latexmk }, projectFolder, main: "main.tex", outDir, signal: new AbortController().signal, logger,
    });
    expect(result.status).toBe("succeeded");
    const states = await readSectionBuildStates(outDir, "main", logger);
    expect(states.map(({ command, absolutePage, line, file }) => ({ command, absolutePage, line, file }))).toEqual([
      { command: "section", absolutePage: 1, line: 3, file: "main.tex" },
      { command: "section", absolutePage: 2, line: 1, file: "chapters/two.tex" },
      { command: "section", absolutePage: 3, line: 9, file: "main.tex" },
    ]);
    expect(states.map(({ counters }) => [counters.section, counters.equation, counters.figure, counters.page])).toEqual([
      [0, 0, 0, 1], [1, 1, 1, 2], [2, 2, 1, 3],
    ]);
    expect((await fs.readdir(projectFolder)).sort()).toEqual(["chapters", "main.pdf", "main.tex"]);
  }, 60_000);

  it("records the page a heading lands on when TeX pushes it to the next page, the one its label names", async () => {
    const projectFolder = await makeTempDir();
    const outDir = path.join(await makeTempDir(), "build");
    await fs.writeFile(path.join(projectFolder, "main.tex"), PUSHED);
    const logger = fakeLogger();
    const result = await runLatexBuild({
      toolchain: { engine: "pdflatex", executable: latexmk }, projectFolder, main: "main.tex", outDir, signal: new AbortController().signal, logger,
    });
    expect(result.status).toBe("succeeded");
    const aux = await fs.readFile(path.join(outDir, "main.aux"), "utf8");
    expect(aux).toContain("\\newlabel{two}{{2}{2}");
    const states = await readSectionBuildStates(outDir, "main", logger);
    expect(states.map(({ absolutePage, counters }) => [absolutePage, counters.page, counters.section])).toEqual([[1, 1, 0], [2, 2, 1]]);
  }, 60_000);

  it("returns no states and logs it when no full build wrote the file", async () => {
    const logger = fakeLogger();
    expect(await readSectionBuildStates(await makeTempDir(), "main", logger)).toEqual([]);
    expect(logger.logs).toEqual([expect.objectContaining({ level: "INFO", message: expect.stringContaining("no section state") })]);
  });
});
