/** Verifies the runtime-neutral build helpers: the built PDF path next to its root, and the ordering of a build's problems and preprint entries into the PDF preview's list. */
import type { PageArea } from "../../../src/reader";
import type { LocatedProblem } from "../../../src/latex";
import { posixPathOps } from "../../../src/path/index";
import { deriveBuiltPdfPath, orderPdfProblems } from "../../../src/writing/build/index";
import type { ProjectEntry } from "../../../src/writing/project/index";

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;

const project = (main: string | null): ReadyEntry =>
  ({ kind: "ready", folder: "/lib/projects/p", main: main ?? undefined, settings: { id: "p", format: "latex" } }) as unknown as ReadyEntry;

describe("deriveBuiltPdfPath", () => {
  it("names <root>.pdf next to the root, the main file by default, and nothing without a root", () => {
    expect(deriveBuiltPdfPath(posixPathOps, project("main.tex"))).toBe("/lib/projects/p/main.pdf");
    expect(deriveBuiltPdfPath(posixPathOps, project("main.tex"), "chapters/intro.tex")).toBe("/lib/projects/p/chapters/intro.pdf");
    expect(deriveBuiltPdfPath(posixPathOps, project(null))).toBeUndefined();
  });
});

const area = (page: number, top: number, left = 0): PageArea => ({ page, top, left, right: left + 10, bottom: top + 10 });
const warn = (kind: "undefinedCitation" | "undefinedReference" | "overfull", file: string, line: number, subject?: string): LocatedProblem => ({
  severity: "warning",
  message: `${kind} ${subject ?? ""}`,
  file,
  line,
  kind,
  ...(subject === undefined ? {} : { subject }),
});

describe("orderPdfProblems", () => {
  it("lists placed problems by page, then top, then left", () => {
    const areas: Record<string, PageArea> = { a: area(2, 5), b: area(1, 50), c: area(1, 10, 40), d: area(1, 10, 5) };
    const result = orderPdfProblems({
      build: ["a", "b", "c", "d"].map((s, i) => warn("undefinedCitation", "main.tex", i + 1, s)),
      preprints: [],
      place: (p) => areas[p.subject ?? ""],
    });
    expect(result.map((p) => p.subject)).toEqual(["d", "c", "b", "a"]);
    expect(result[0]?.area).toEqual(areas["d"]);
  });

  it("puts unplaced problems after placed ones, by file then line, without an area", () => {
    const result = orderPdfProblems({
      build: [warn("overfull", "b.tex", 3), warn("undefinedReference", "a.tex", 9, "fig:x"), warn("undefinedReference", "a.tex", 2, "fig:y"), warn("undefinedCitation", "z.tex", 1, "placed")],
      preprints: [],
      place: (p) => (p.subject === "placed" ? area(1, 1) : undefined),
    });
    expect(result.map((p) => p.subject ?? p.kind)).toEqual(["placed", "fig:y", "fig:x", "overfull"]);
    expect(result[1]).not.toHaveProperty("area");
  });

  it("collapses problems with the same kind, subject, file and line, and places once per problem", () => {
    const place = jest.fn(() => area(1, 1));
    const result = orderPdfProblems({
      build: [warn("undefinedCitation", "main.tex", 4, "k"), warn("undefinedCitation", "main.tex", 4, "k"), warn("undefinedCitation", "main.tex", 5, "k")],
      preprints: [],
      place,
    });
    expect(result).toHaveLength(2);
    expect(place).toHaveBeenCalledTimes(2);
  });

  it("skips build problems without a kind and maps preprints to kind preprint with the key as subject", () => {
    const result = orderPdfProblems({
      build: [{ severity: "error", message: "Missing }", file: "main.tex", line: 1 }],
      preprints: [{ key: "smith24", message: "Cites a preprint", file: "refs.bib", line: 7 }],
      place: () => undefined,
    });
    expect(result).toEqual([{ kind: "preprint", subject: "smith24", message: "Cites a preprint", file: "refs.bib", line: 7 }]);
  });

  it("sorts unplaced problems without a file or line last", () => {
    const result = orderPdfProblems({
      build: [],
      preprints: [{ key: "nofile", message: "m" }, { key: "withfile", message: "m", file: "refs.bib", line: 2 }],
      place: () => undefined,
    });
    expect(result.map((p) => p.subject)).toEqual(["withfile", "nofile"]);
  });
});
