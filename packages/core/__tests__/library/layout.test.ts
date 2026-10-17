import * as path from "node:path";

import {
  APPDATA_DIR, BIB_FILE, METADATA_FILE, PAPERS_DIR, PDF_FILE, RESEARCH_DIR, SIDECAR_FILE,
  joinWith, libraryLayout, paperFiles,
} from "@labshelf/core";

describe("layout constants", () => {
  it("pin the on-disk names", () => {
    expect([PAPERS_DIR, RESEARCH_DIR, APPDATA_DIR]).toEqual(["papers", ".research", "appdata"]);
    expect([PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE]).toEqual(["paper.pdf", "metadata.yaml", "bib.bib", "data.json"]);
  });
});

describe.each([
  ["posix", path.posix.join, "/data/lib"],
  ["win32", path.win32.join, "C:\\data\\lib"],
])("libraryLayout with path.%s.join", (_name, join, root) => {
  const l = libraryLayout(root, join);
  const at = (...parts: string[]) => join(root, ...parts);

  it("derives papers/ and .research/ locations from the root", () => {
    expect(l.root).toBe(root);
    expect(l.papersRoot()).toBe(at("papers"));
    expect(l.researchRoot()).toBe(at(".research"));
    expect(l.paperDataRoot()).toBe(at(".research", "papers"));
    expect(l.paperDataDir("p1")).toBe(at(".research", "papers", "p1"));
    expect(l.paperDataPath("p1")).toBe(at(".research", "papers", "p1", "data.json"));
    expect(l.tmpDir()).toBe(at(".research", "tmp"));
  });

  it("keeps the temp folder outside the papers and paper-data roots", () => {
    const sep = join("a", "b")[1];
    expect(l.tmpDir().startsWith(l.papersRoot() + sep)).toBe(false);
    expect(l.tmpDir().startsWith(l.paperDataRoot() + sep)).toBe(false);
  });

  it("lists the folders to create and the folders that mark a library", () => {
    expect(l.requiredDirs()).toEqual([
      at(".research"), at(".research", "papers"), at("papers"),
    ]);
    expect(l.markerDirs()).toEqual([at("papers"), at(".research")]);
  });
});

describe("joinWith", () => {
  it("joins with the given separator and skips empty parts", () => {
    expect(joinWith("/")("a", "b", "c")).toBe("a/b/c");
    expect(joinWith("\\")("a", "", "c")).toBe("a\\c");
    expect(joinWith("/")("", "papers")).toBe("papers");
  });

  it("yields relative keys on an empty root", () => {
    const l = libraryLayout("", joinWith("/"));
    expect(l.papersRoot()).toBe("papers");
    expect(l.paperDataPath("p1")).toBe(".research/papers/p1/data.json");
  });
});

describe("a generic join", () => {
  it("works over any path type", () => {
    type Uri = { parts: string[] };
    const join = (base: Uri, ...segments: string[]): Uri => ({ parts: [...base.parts, ...segments] });
    const l = libraryLayout<Uri>({ parts: ["lib"] }, join);
    expect(l.paperDataPath("p1").parts).toEqual(["lib", ".research", "papers", "p1", "data.json"]);
    expect(l.requiredDirs().map((u) => u.parts.join("/"))).toContain("lib/.research/papers");
  });
});

describe("paperFiles", () => {
  it("names the files inside a paper folder", () => {
    expect(paperFiles("/lib/papers/p1", path.posix.join)).toEqual({
      pdf: "/lib/papers/p1/paper.pdf",
      metadata: "/lib/papers/p1/metadata.yaml",
      bib: "/lib/papers/p1/bib.bib",
    });
  });
});
