/** Verifies reading a project's checklist signals and hand-added items, and editing checklist.json through the file-system port. */
import { posixPathOps } from "../../../src/path/index";
import { addManualItem, listManualItems } from "../../../src/writing/checks/checklist";
import { readChecklistSignals, readManualItems, updateChecklist } from "../../../src/writing/checks/checklistSignals";
import type { ProjectEntry } from "../../../src/writing/project/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { memoryCatalog, readText } from "../../support/memoryProjectCatalog";

describe("readManualItems", () => {
  const NOW = "2026-10-16T09:12:00.000Z";
  const FILE = "/p/.labshelf/checklist.json";
  const item = { id: "a", text: "Ask Ana", done: false, createdAt: NOW };

  describe("readManualItems", () => {
    it("reads no items from a project without a checklist file", async () => {
      const logger = fakeLogger();
      expect(await readManualItems({ fs: new MemoryLibraryFs(), paths: posixPathOps, logger }, "/p")).toEqual([]);
      expect(logger.logs).toEqual([]);
    });

    it("reads the valid items of an existing file", async () => {
      const fs = new MemoryLibraryFs();
      await fs.writeText(FILE, JSON.stringify({ items: [item, { id: "bad" }] }));
      expect(await readManualItems({ fs, paths: posixPathOps, logger: fakeLogger() }, "/p")).toEqual([item]);
    });

    it("reads a malformed file as no items and logs a warning", async () => {
      const fs = new MemoryLibraryFs();
      await fs.writeText(FILE, "not json");
      const logger = fakeLogger();
      expect(await readManualItems({ fs, paths: posixPathOps, logger }, "/p")).toEqual([]);
      expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
    });

    it("reads an unreadable file as no items and logs the error", async () => {
      const fs = new MemoryLibraryFs();
      await fs.writeText(FILE, "{}");
      fs.readText = async () => { throw new Error("EIO"); };
      const logger = fakeLogger();
      expect(await readManualItems({ fs, paths: posixPathOps, logger }, "/p")).toEqual([]);
      expect(logger.errors).toHaveLength(1);
    });
  });
});

describe("updateChecklist", () => {
  const NOW = "2026-10-16T09:12:00.000Z";
  const FOLDER = "/p";
  const FILE = `${FOLDER}/.labshelf/checklist.json`;
  const item = { id: "a", text: "Ask Ana", done: false, createdAt: NOW };

  describe("updateChecklist", () => {
    it("creates the file and its folder on the first edit, passing an empty document", async () => {
      const context = memoryCatalog();
      let received: unknown;
      await updateChecklist(context, FOLDER, (doc) => {
        received = JSON.parse(JSON.stringify(doc));
        return addManualItem(doc, { id: "a", text: "Ask Ana", now: NOW });
      });
      expect(received).toEqual({ items: [] });
      expect(JSON.parse(readText(context.fs, FILE))).toEqual({ items: [item] });
      expect(await context.fs.listDir(`${FOLDER}/.labshelf`)).toEqual(["checklist.json"]);
      expect(listManualItems(JSON.parse(readText(context.fs, FILE)))).toEqual([item]);
    });

    it("keeps unknown keys and invalid items on edit", async () => {
      const context = memoryCatalog();
      await context.fs.writeText(FILE, JSON.stringify({ keep: true, items: [{ id: "bad" }] }));
      await updateChecklist(context, FOLDER, (doc) => addManualItem(doc, { id: "a", text: "Ask Ana", now: NOW }));
      expect(JSON.parse(readText(context.fs, FILE))).toEqual({ keep: true, items: [{ id: "bad" }, item] });
    });

    it("passes the stored document to the edit and skips an unchanged write", async () => {
      const context = memoryCatalog();
      await context.fs.writeText(FILE, JSON.stringify({ items: [item] }, null, 2) + "\n");
      const writes = context.fs.writes;
      let seen: string[] = [];
      await updateChecklist(context, FOLDER, (doc) => { seen = listManualItems(doc).map((entry) => entry.id); return doc; });
      expect(seen).toEqual(["a"]);
      expect(context.fs.writes).toBe(writes);
    });

    it("never overwrites a malformed file, fails the edit and logs it with the path", async () => {
      const context = memoryCatalog();
      await context.fs.writeText(FILE, '{"items": 3}');
      await expect(updateChecklist(context, FOLDER, (doc) => addManualItem(doc, { id: "a", text: "t", now: NOW }))).rejects.toThrow(FILE);
      expect(readText(context.fs, FILE)).toBe('{"items": 3}');
      expect(context.logger.errors).toEqual([{ module: "writing/checklist", context: { file: FILE } }]);
    });
  });
});

describe("readChecklistSignals", () => {
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
});
