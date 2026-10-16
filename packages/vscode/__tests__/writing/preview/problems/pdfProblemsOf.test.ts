// Tests that a root's build problems are placed through SyncTeX or Typst cite targets and counted for the preview footer.
import * as path from "node:path";

import type { LocatedProblem, SyncIndex, TypstCite } from "@labshelf/core";
import { pdfProblemsOf, type PdfProblemsDeps } from "../../../../src/writing/preview/problems";
import type { SynctexLookup } from "../../../../src/writing/preview/sourceLinks/projectSynctex";
import type { ReadyProject } from "../../../../src/writing/mainDocument";
import { fakeLogger, readyEntry } from "../../../support/writingFixtures";

const latex = readyEntry("/lib/paper") as ReadyProject;
const typst = { ...latex, main: "main.typ", settings: { ...latex.settings, format: "typst" } } as ReadyProject;

function indexOf(lines: Record<number, { page: number; x: number; y: number }>): SyncIndex {
  const positions = new Map(Object.entries(lines).map(([line, at]) => [Number(line), { ...at, mark: false }]));
  const byFile = new Map([["/lib/paper/main.tex", { positions, lines: [...positions.keys()].sort((a, b) => a - b) }]]);
  return { files: new Map(), pages: new Map(), byFile };
}

const found = (lines: Record<number, { page: number; x: number; y: number }>): SynctexLookup => ({ status: "found", index: indexOf(lines) });

const problem = (over: Partial<LocatedProblem>): LocatedProblem => ({
  severity: "warning", message: "m", file: "/lib/paper/main.tex", ...over,
});

function deps(over: Partial<PdfProblemsDeps> = {}) {
  const logger = fakeLogger();
  const all: PdfProblemsDeps = {
    logger, paths: path,
    problemsOf: () => [],
    preprints: async () => [],
    synctex: async () => found({}),
    typstCites: () => [],
    readSources: async () => [],
    ...over,
  };
  return { all, logger };
}

describe("pdfProblemsOf", () => {
  it("places LaTeX problems by SyncTeX with project-relative files", async () => {
    const { all } = deps({
      problemsOf: () => [problem({ kind: "undefinedCitation", subject: "a", line: 4 })],
      synctex: async () => found({ 4: { page: 2, x: 30, y: 40 } }),
    });
    const { pdfProblems } = await pdfProblemsOf(all, latex, "main.tex");
    expect(pdfProblems).toEqual([
      { kind: "undefinedCitation", subject: "a", message: "m", file: "main.tex", line: 4, area: { page: 2, left: 30, right: 30, top: 40, bottom: 40 } },
    ]);
  });

  it("orders placed problems by reading position and leaves the rest last", async () => {
    const { all } = deps({
      problemsOf: () => [
        problem({ kind: "undefinedReference", subject: "r", line: 9 }),
        problem({ kind: "overfull", line: 4 }),
        problem({ kind: "undefinedCitation", subject: "c", file: "/lib/paper/other.tex", line: 1 }),
      ],
      synctex: async () => found({ 4: { page: 1, x: 5, y: 5 }, 9: { page: 3, x: 5, y: 5 } }),
    });
    const kinds = (await pdfProblemsOf(all, latex, "main.tex")).pdfProblems.map((p) => p.kind);
    expect(kinds).toEqual(["overfull", "undefinedReference", "undefinedCitation"]);
  });

  it("includes preprint entries and places them by their source line", async () => {
    const { all } = deps({
      preprints: async () => [{ key: "p", message: "preprint", file: "main.tex", line: 4 }],
      synctex: async () => found({ 4: { page: 1, x: 1, y: 2 } }),
    });
    const { pdfProblems } = await pdfProblemsOf(all, latex, "main.tex");
    expect(pdfProblems).toMatchObject([{ kind: "preprint", subject: "p", file: "main.tex", area: { page: 1 } }]);
  });

  it("keeps problems unplaced and logs once when SyncTeX is unreadable", async () => {
    const { all, logger } = deps({
      problemsOf: () => [problem({ kind: "undefinedCitation", subject: "a", line: 4 }), problem({ kind: "overfull", line: 6 })],
      synctex: async () => ({ status: "unreadable" }),
    });
    const { pdfProblems } = await pdfProblemsOf(all, latex, "main.tex");
    expect(pdfProblems.map((p) => "area" in p)).toEqual([false, false]);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0]![3]).toMatchObject({ root: "main.tex", reason: "unreadable" });
  });

  it("keeps problems unplaced and logs the error when the SyncTeX load throws", async () => {
    const { all, logger } = deps({
      problemsOf: () => [problem({ kind: "overfull", line: 6 })],
      synctex: async () => { throw new Error("boom"); },
    });
    const { pdfProblems } = await pdfProblemsOf(all, latex, "main.tex");
    expect(pdfProblems).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("places only citation and preprint problems of a Typst root, by cite key", async () => {
    const cites: TypstCite[] = [{ key: "a", at: { page: 2, x: 10, y: 20 } }];
    const { all } = deps({
      problemsOf: () => [
        problem({ kind: "undefinedCitation", subject: "a", file: "/lib/paper/main.typ", line: 2 }),
        problem({ kind: "undefinedReference", subject: "a", file: "/lib/paper/main.typ", line: 3 }),
        problem({ kind: "undefinedCitation", subject: "zz", file: "/lib/paper/main.typ", line: 5 }),
      ],
      preprints: async () => [{ key: "a", message: "preprint", file: "main.typ", line: 7 }],
      typstCites: () => cites,
    });
    const { pdfProblems } = await pdfProblemsOf(all, typst, "main.typ");
    const placed = pdfProblems.filter((p) => p.area).map((p) => p.kind);
    expect(placed).toEqual(["undefinedCitation", "preprint"]);
    expect(pdfProblems.filter((p) => !p.area).map((p) => p.line)).toEqual([3, 5]);
  });

  it("does not load SyncTeX for a Typst root", async () => {
    const synctex = jest.fn(async () => found({}));
    const { all } = deps({ synctex, problemsOf: () => [problem({ kind: "overfull", line: 1 })] });
    await pdfProblemsOf(all, typst, "main.typ");
    expect(synctex).not.toHaveBeenCalled();
  });

  it("counts distinct cited keys across the root's sources", async () => {
    const { all } = deps({
      readSources: async () => [
        { file: "main.tex", text: "\\cite{a,b} and \\citep{a}" },
        { file: "ch1.tex", text: "\\cite{c} \\cite{b}" },
      ],
    });
    expect((await pdfProblemsOf(all, latex, "main.tex")).cites).toBe(3);
  });

  it("counts Typst references", async () => {
    const { all } = deps({ readSources: async () => [{ file: "main.typ", text: "see @a and @b, then @a" }] });
    expect((await pdfProblemsOf(all, typst, "main.typ")).cites).toBe(2);
  });
});
