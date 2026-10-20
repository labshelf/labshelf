// Tests that a library folder's papers become share inputs with their bib, PDF and, when asked, annotations, and which folders can be shared.
import { posixPathOps } from "../../../src/library/index";
import type { Annotation, PaperRecord } from "../../../src/model/index";
import { papersInFolder, shareableFolders, sharePaperInputs } from "../../../src/share/index";

const ROOT = "/lib/papers";

function record(id: string, folder: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, citeKey: id, title: `Title ${id}`, path: `${ROOT}/${folder}/${id}`, status: "reading", tags: ["mine"], note: "private", ...extra } as PaperRecord;
}

const files = new Map<string, string | Uint8Array>([
  [`${ROOT}/Group/a/bib.bib`, "@article{a}"],
  [`${ROOT}/Group/a/paper.pdf`, new Uint8Array([1, 2, 3])],
]);
const annotation = { id: "n1", paperId: "a", type: "note", pageNumber: 1, content: "x" } as Annotation;
const sources = {
  fs: {
    exists: (path: string) => Promise.resolve(files.has(path)),
    readText: (path: string) => Promise.resolve(files.get(path) as string),
    readFile: (path: string) => Promise.resolve(files.get(path) as Uint8Array),
  },
  paths: posixPathOps,
  annotations: (paperId: string) => Promise.resolve(paperId === "a" ? [annotation] : []),
};

describe("sharePaperInputs", () => {
  it("reads the bib and PDF of each paper and the annotations only when they are shared", async () => {
    const papers = [record("a", "Group", { year: 2017 }), record("b", "Group")];
    const withNotes = await sharePaperInputs(papers, true, sources);
    expect(withNotes[0]).toEqual({ metadata: papers[0], bib: "@article{a}", pdf: new Uint8Array([1, 2, 3]), annotations: [annotation] });
    expect(withNotes[1]).toEqual({ metadata: papers[1] });
    expect((await sharePaperInputs(papers, false, sources))[0]?.annotations).toBeUndefined();
  });
});

describe("papersInFolder", () => {
  it("holds the papers of nested folders and none of a sibling whose name starts the same", () => {
    const papers = [record("a", "Group"), record("b", "Group/Week 1/Day 2"), record("c", "Group 2"), record("d", "Other")];
    expect(papersInFolder(papers, `${ROOT}/Group`, "/").map((paper) => paper.id)).toEqual(["a", "b"]);
  });
});

describe("shareableFolders", () => {
  it("lists every folder that holds papers at any depth, with its count, without the library root", () => {
    const papers = [record("a", "Group"), record("b", "Group/Week 1/Day 2"), record("c", "Other")];
    expect(shareableFolders(papers, ROOT, "/")).toEqual([
      { dir: `${ROOT}/Group`, label: "Group", count: 2 },
      { dir: `${ROOT}/Group/Week 1`, label: "Group / Week 1", count: 1 },
      { dir: `${ROOT}/Group/Week 1/Day 2`, label: "Group / Week 1 / Day 2", count: 1 },
      { dir: `${ROOT}/Other`, label: "Other", count: 1 },
    ]);
  });
});
