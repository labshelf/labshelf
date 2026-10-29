/** Pins sharing a library folder: which folders can be shared, the papers' bib, PDF and annotations read as share inputs, the share link made from nested papers with annotations only when chosen, and the counted wording of the rights notice. */
import { posixPathOps } from "../../src/path/index";
import type { Annotation, PaperRecord } from "../../src/model/index";
import {
  listPapersInFolder,
  listShareableFolders,
  createSharePaperInputs,
  loadShareRegistry,
  openShare,
  createShareLink,
  type ShareFolderStage,
  describeShareRightsNotice,
} from "../../src/share/index";
import { makeHarness, PAPERS } from "../support/mutationHarness";
import { memoryShareRegistry, memoryShareRelay } from "../support/memoryShareRelay";

const ROOT = "/lib/papers";

function record(id: string, folder: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, citeKey: id, title: `Title ${id}`, path: `${ROOT}/${folder}/${id}`, status: "reading", tags: ["mine"], note: "private", ...extra } as PaperRecord;
}

const files = new Map<string, string | Uint8Array>([
  [`${ROOT}/Group/a/bib.bib`, "@article{a}"],
  [`${ROOT}/Group/a/paper.pdf`, new Uint8Array([1, 2, 3])],
]);
const annotation = { id: "n1", paperId: "a", type: "comment", pageNumber: 1, content: "x" } as Annotation;
const sources = {
  fs: {
    exists: (path: string) => Promise.resolve(files.has(path)),
    readText: (path: string) => Promise.resolve(files.get(path) as string),
    readFile: (path: string) => Promise.resolve(files.get(path) as Uint8Array),
  },
  paths: posixPathOps,
  annotations: (paperId: string) => Promise.resolve(paperId === "a" ? [annotation] : []),
};

describe("createSharePaperInputs", () => {
  it("reads the bib and PDF of each paper and the annotations only when they are shared", async () => {
    const papers = [record("a", "Group", { year: 2017 }), record("b", "Group")];
    const withNotes = await createSharePaperInputs(papers, true, sources);
    expect(withNotes[0]).toEqual({ metadata: papers[0], bib: "@article{a}", pdf: new Uint8Array([1, 2, 3]), annotations: [annotation] });
    expect(withNotes[1]).toEqual({ metadata: papers[1] });
    expect((await createSharePaperInputs(papers, false, sources))[0]?.annotations).toBeUndefined();
  });
});

describe("listPapersInFolder", () => {
  it("holds the papers of nested folders and none of a sibling whose name starts the same", () => {
    const papers = [record("a", "Group"), record("b", "Group/Week 1/Day 2"), record("c", "Group 2"), record("d", "Other")];
    expect(listPapersInFolder(papers, `${ROOT}/Group`, "/").map((paper) => paper.id)).toEqual(["a", "b"]);
  });
});

describe("listShareableFolders", () => {
  it("lists every folder that holds papers at any depth, with its count, without the library root", () => {
    const papers = [record("a", "Group"), record("b", "Group/Week 1/Day 2"), record("c", "Other")];
    expect(listShareableFolders(papers, ROOT, "/")).toEqual([
      { dir: `${ROOT}/Group`, label: "Group", count: 2 },
      { dir: `${ROOT}/Group/Week 1`, label: "Group / Week 1", count: 1 },
      { dir: `${ROOT}/Group/Week 1/Day 2`, label: "Group / Week 1 / Day 2", count: 1 },
      { dir: `${ROOT}/Other`, label: "Other", count: 1 },
    ]);
  });
});

const relayUrl = "https://relay.someone.workers.dev";

function paperIn(id: string, folder: string): PaperRecord {
  return { id, citeKey: id, title: `Title ${id}`, path: `${PAPERS}/${folder}/${id}` } as PaperRecord;
}

async function share(withAnnotations: boolean) {
  const h = makeHarness();
  const papers = [paperIn("a", "Group"), paperIn("b", "Group/Week 1"), paperIn("c", "Other")];
  for (const paper of papers) { await h.seedPaper(paper.path, { title: paper.title }); }
  const relay = memoryShareRelay();
  const registry = memoryShareRegistry();
  const stages: ShareFolderStage[] = [];
  const link = await createShareLink({
    papers, folder: `${PAPERS}/Group`, withAnnotations, relayUrl, registry, logger: h.ctx.logger,
    sources: { fs: h.fs, paths: posixPathOps, annotations: async (id) => (id === "a" ? [annotation] : []) },
    backendFor: () => relay.backend, onStage: (stage) => stages.push(stage),
  });
  const opened = await openShare(link, () => relay.reader);
  if (!opened.ok) { throw new Error(`openShare failed: ${opened.error}`); }
  return { stages, manifest: opened.share.manifest, registry };
}

describe("createShareLink", () => {
  it("uploads the folder's papers at any depth with their annotations, and lists the share", async () => {
    const { stages, manifest, registry } = await share(true);
    expect(manifest.folder).toBe("Group");
    expect(manifest.papers.map((paper) => paper.metadata.id)).toEqual(["a", "b"]);
    expect(manifest.papers[0]?.annotations).toEqual([annotation]);
    expect(manifest.papers[0]?.pdf).toBeDefined();
    expect(stages).toEqual(["reading", "encrypting", "uploading"]);
    expect((await loadShareRegistry(registry)).shares).toHaveLength(1);
  });

  it("leaves the annotations out when the share is made without them", async () => {
    const { manifest } = await share(false);
    expect(manifest.papers.every((paper) => paper.annotations === undefined)).toBe(true);
  });
});

describe("describeShareRightsNotice", () => {
  it("names one paper in the singular", () => {
    expect(describeShareRightsNotice({ label: "Solo", count: 1 }).detail).toContain('read the 1 paper of "Solo"');
  });
  it("names several papers in the plural", () => {
    expect(describeShareRightsNotice({ label: "Group", count: 2 }).detail).toContain('read the 2 papers of "Group"');
  });
});
