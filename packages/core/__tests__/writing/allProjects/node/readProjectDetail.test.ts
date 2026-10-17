/** Verifies the All projects detail and citation counts read from a real project folder and the library papers. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PaperRecord } from "../../../../src/model/index";
import { BIBLIOGRAPHY_HEADER } from "../../../../src/writing/citations/index";
import { readProjectCites, readProjectDetail } from "../../../../src/writing/allProjects/node/index";
import type { ProjectBuildSummary } from "../../../../src/writing/allProjects/index";
import type { ProjectSettings } from "../../../../src/writing/project/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { replayLoader } from "../../../support/replayPdfjs";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const PDF = path.join(__dirname, "..", "..", "checks", "fixtures", "check.pdf");
const build: ProjectBuildSummary = { state: "ok", at: 5, warnings: 1, errors: 0 };

const papers: PaperRecord[] = [{
  id: "vaswani2017", title: "Attention", path: "/lib/vaswani2017", citeKey: "vaswani2017", status: "done",
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017,
}];

const MAIN = [
  "\\documentclass{article}", "\\begin{document}", "\\input{sections/intro}", "Local \\cite{local2020}.",
  "\\bibliography{labshelf,refs}", "After the references \\cite{late}.", "\\end{document}",
].join("\n");

async function write(folder: string, file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
  await fs.writeFile(path.join(folder, file), text);
}

async function latexProject(extra: Partial<ProjectSettings> = {}): Promise<{ folder: string; settings: ProjectSettings }> {
  const folder = await makeTempDir();
  await write(folder, "main.tex", MAIN);
  await write(folder, "sections/intro.tex", "One two three \\cite{vaswani2017, ghost}. % \\cite{commented}\n");
  await write(folder, "refs.bib", "@article{local2020,\n  title = {Local},\n}\n@book{late,\n  title = {Late},\n}\n");
  await write(folder, "labshelf.bib", `${BIBLIOGRAPHY_HEADER}\n\n@article{vaswani2017,\n  title = {Attention},\n}\n`);
  await write(folder, ".labshelf/versions/v1/version.json", JSON.stringify({ name: "Submitted", created: "2026-03-01T10:00:00Z" }));
  await write(folder, ".labshelf/versions/v2/version.json", JSON.stringify({ name: "Revised", created: "2026-05-01T10:00:00Z" }));
  await write(folder, "main.log", "This is pdfTeX\n");
  const settings: ProjectSettings = { id: "paper", format: "latex", main: "main.tex", engine: "tectonic", bibliography: "labshelf.bib", ...extra };
  return { folder, settings };
}

describe("readProjectDetail", () => {
  it("reads the engine, pages, limits, citations, bibliography, versions and sources of a LaTeX project", async () => {
    const { folder, settings } = await latexProject({ check: { pages: 8, words: 12, countUpTo: "references", anonymous: true } });
    const logger = fakeLogger();
    const detail = await readProjectDetail(
      { id: "paper", folder, settings, papers, build, pdf: PDF, log: path.join(folder, "main.log"), pdfjs: replayLoader(PDF).loader }, logger,
    );
    expect(detail).toEqual({
      id: "paper",
      location: folder,
      engine: "tectonic",
      pages: 10,
      limits: { countUpTo: "references", pages: { counted: 10, limit: 8 }, words: { counted: expect.any(Number), limit: 12 } },
      build,
      log: "main.log",
      bibliography: { file: "labshelf.bib", entries: 1, generated: true, written: expect.any(Number) },
      citations: [
        { key: "ghost", source: "none" },
        { key: "late", source: "bib" },
        { key: "local2020", source: "bib" },
        { key: "vaswani2017", source: "library", paperId: "vaswani2017", title: "Attention", authors: "Vaswani et al.", year: "2017" },
      ],
      versions: [{ name: "Revised", created: "2026-05-01T10:00:00Z" }, { name: "Submitted", created: "2026-03-01T10:00:00Z" }],
      sources: ["main.tex", "sections/intro.tex"],
    });
    expect(logger.logs.filter((entry) => entry.level === "WARN")).toEqual([]);
  });

  it("counts words up to the references only when the limit counts up to them", async () => {
    const { folder, settings } = await latexProject({ check: { words: 100, countUpTo: "references", anonymous: true } });
    const toReferences = await readProjectDetail({ id: "paper", folder, settings, papers, build, pdfjs: replayLoader(PDF).loader }, fakeLogger());
    const toEnd = await readProjectDetail(
      { id: "paper", folder, settings: { ...settings, check: { words: 100, countUpTo: "end", anonymous: true } }, papers, build, pdfjs: replayLoader(PDF).loader }, fakeLogger(),
    );
    expect(toEnd.limits.words!.counted).toBeGreaterThan(toReferences.limits.words!.counted);
    expect(toEnd.limits.countUpTo).toBe("end");
  });

  it("leaves out the parts that do not exist: no PDF, no log, no bibliography, no versions, no limits", async () => {
    const folder = await makeTempDir();
    await write(folder, "main.tex", "\\begin{document}Hello\\end{document}");
    const detail = await readProjectDetail(
      { id: "p", folder, settings: { id: "p", format: "latex", main: "main.tex" }, papers, build, pdfjs: replayLoader(PDF).loader }, fakeLogger(),
    );
    expect(detail).toEqual({
      id: "p", location: folder, limits: { countUpTo: "references", words: { counted: 1 } }, build, citations: [], versions: [], sources: ["main.tex"],
    });
  });

  it("logs a missing PDF with the folder and still returns the rest", async () => {
    const { folder, settings } = await latexProject();
    const logger = fakeLogger();
    const detail = await readProjectDetail(
      { id: "paper", folder, settings, papers, build, pdf: path.join(folder, "missing.pdf"), pdfjs: replayLoader(PDF).loader }, logger,
    );
    expect(detail.pages).toBeUndefined();
    expect(detail.limits.pages).toBeUndefined();
    expect(detail.citations).toHaveLength(4);
    expect(logger.logs).toEqual([{ level: "WARN", module: "writing/allProjects", message: expect.stringContaining("PDF") }]);
  });

  it("marks a bibliography the user wrote as not generated", async () => {
    const { folder, settings } = await latexProject({ bibliography: "refs.bib" });
    const detail = await readProjectDetail({ id: "paper", folder, settings, papers, build, pdfjs: replayLoader(PDF).loader }, fakeLogger());
    expect(detail.bibliography).toEqual({ file: "refs.bib", entries: 2, generated: false, written: expect.any(Number) });
  });

  it("reads a Typst project from its main file alone and names the compiler version", async () => {
    const folder = await makeTempDir();
    await write(folder, "main.typ", "= Title\nSee @vaswani2017 and @nobody.\n");
    await write(folder, "other.typ", "@ignored");
    const settings: ProjectSettings = { id: "t", format: "typst", main: "main.typ", typst: "0.13.1" };
    const detail = await readProjectDetail({ id: "t", folder, settings, papers, build, pdfjs: replayLoader(PDF).loader }, fakeLogger());
    expect(detail.engine).toBe("Typst 0.13.1");
    expect(detail.sources).toEqual(["main.typ"]);
    expect(detail.citations.map((citation) => [citation.key, citation.source])).toEqual([["nobody", "none"], ["vaswani2017", "library"]]);
  });
});

describe("readProjectCites", () => {
  it("counts the distinct cited keys and those found nowhere", async () => {
    const { folder, settings } = await latexProject();
    expect(await readProjectCites(folder, settings, papers)).toEqual({ cites: 4, unresolved: 1 });
  });

  it("is zero for a project without a main file", async () => {
    const folder = await makeTempDir();
    expect(await readProjectCites(folder, { id: "p", format: "latex" }, papers)).toEqual({ cites: 0, unresolved: 0 });
  });
});
