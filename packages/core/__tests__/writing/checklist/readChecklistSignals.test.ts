/** Verifies the open-item signals read from a real writing project folder. */
import { posixPathOps } from "../../../src/path/index";
import type { ProjectEntry } from "../../../src/writing/project/index";
import { readChecklistSignals } from "../../../src/writing/checklist/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const FOLDER = "/p";

type Ready = Extract<ProjectEntry, { kind: "ready" }>;

function readyProject(folder: string, format: "latex" | "typst", main: string | undefined, figures?: Ready["settings"]["figures"]): Ready {
  return { kind: "ready", folder, location: "external", main, settings: { id: "p", format, main, figures } };
}

async function put(fs: MemoryLibraryFs, file: string, text: string, mtimeSeconds?: number): Promise<void> {
  await fs.writeText(`${FOLDER}/${file}`, text);
  if (mtimeSeconds !== undefined) { fs.mtimes.set(`${FOLDER}/${file}`, mtimeSeconds * 1000); }
}

function folderFs(): MemoryLibraryFs {
  const fs = new MemoryLibraryFs();
  void fs.ensureDir(FOLDER);
  return fs;
}

const reads = (fs: MemoryLibraryFs, logger = fakeLogger()) => ({ fs, paths: posixPathOps, logger });

const MAIN = ["\\documentclass{article}", "\\begin{document}", "See \\ref{sec:missing}.", "\\input{chapters/intro}", "\\end{document}", ""].join("\n");
const INTRO = ["\\section{Intro}\\label{sec:intro}", "% TODO: cite more", ""].join("\n");
const manualItem = { id: "m1", text: "Ask Ana", done: false, createdAt: "2026-10-16T09:12:00.000Z" };
const doneItem = { id: "m2", text: "Fix title", done: true, createdAt: "2026-10-15T09:12:00.000Z", doneAt: "2026-10-16T08:00:00.000Z" };

describe("readChecklistSignals", () => {
  it("reads sources, todos, broken refs, manual items and stale figures of a LaTeX project", async () => {
    const fs = folderFs();
    await put(fs, "main.tex", MAIN.replace("\\input{chapters/intro}", "\\input{chapters/intro}\n\\input{chapters/missing}"));
    await put(fs, "chapters/intro.tex", INTRO);
    await put(fs, ".labshelf/checklist.json", JSON.stringify({ items: [manualItem, doneItem] }));
    await put(fs, "fig/a.pdf", "x", 1_700_000_000);
    await put(fs, "plot.py", "x", 1_700_000_100);
    const project = readyProject(FOLDER, "latex", "main.tex", { "fig/a.pdf": { run: "python plot.py", inputs: ["plot.py"] } });
    const logger = fakeLogger();

    const signals = await readChecklistSignals(reads(fs, logger), project);

    expect(signals.sources.map((source) => ({ path: source.path, format: source.format }))).toEqual([
      { path: "main.tex", format: "latex" },
      { path: "chapters/intro.tex", format: "latex" },
    ]);
    expect(signals.sources[1]!.text).toBe(INTRO);
    expect(signals.todos).toEqual([{ file: "chapters/intro.tex", line: 1, text: "cite more" }]);
    expect(signals.brokenRefs).toEqual([{ file: "main.tex", line: 2, ref: "sec:missing" }]);
    expect(signals.staleFigures).toEqual([{ name: "fig/a.pdf" }]);
    expect(signals.manual).toEqual([manualItem, doneItem]);
  });

  it("reports no stale figures when the project declares none, or the figures are fresh", async () => {
    const fs = folderFs();
    await put(fs, "main.tex", MAIN);
    expect((await readChecklistSignals(reads(fs, fakeLogger()), readyProject(FOLDER, "latex", "main.tex"))).staleFigures).toEqual([]);

    await put(fs, "plot.py", "x", 1_700_000_000);
    await put(fs, "fig/a.pdf", "x", 1_700_000_100);
    const fresh = readyProject(FOLDER, "latex", "main.tex", { "fig/a.pdf": { run: "python plot.py", inputs: ["plot.py"] } });
    expect((await readChecklistSignals(reads(fs, fakeLogger()), fresh)).staleFigures).toEqual([]);
  });

  it("reads only the main file of a Typst project, with its todos and no broken refs", async () => {
    const fs = folderFs();
    const main = ["= Intro", "@missing", "// TODO: write abstract", ""].join("\n");
    await put(fs, "main.typ", main);
    await put(fs, "other.typ", "// TODO: not a source");

    const signals = await readChecklistSignals(reads(fs, fakeLogger()), readyProject(FOLDER, "typst", "main.typ"));

    expect(signals.sources.map((source) => ({ path: source.path, format: source.format, text: source.text }))).toEqual([
      { path: "main.typ", format: "typst", text: main },
    ]);
    expect(signals.todos).toEqual([{ file: "main.typ", line: 2, text: "write abstract" }]);
    expect(signals.brokenRefs).toEqual([]);
    expect(signals.manual).toEqual([]);
  });

  it("returns empty signals and logs one warning when the main file cannot be read", async () => {
    const fs = folderFs();
    const logger = fakeLogger();

    const signals = await readChecklistSignals(reads(fs, logger), readyProject(FOLDER, "latex", "main.tex"));

    expect(signals).toEqual({ sources: [], todos: [], brokenRefs: [], staleFigures: [], manual: [] });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });
});
