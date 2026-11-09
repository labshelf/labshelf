/** Verifies how the entries of a .bib file become library papers: the paper's fields, which entries the library already holds, and the folder's name. */
import type { PaperRecord } from "../../../src/model/index";
import { parseBibEntries, countLinkedFolders } from "../../../src/writing/citations/index";
import {
  createPaperFromBibEntry, deriveBibPaperInput, deriveImportFolderName, describeBibImport, formatLibraryFolder, planBibImport, readBibIdentifier,
} from "../../../src/writing/citations/bibliographyImport";

const entry = (text: string) => parseBibEntries(text)[0]!;
const paper = (over: Partial<PaperRecord>): PaperRecord => ({ id: "x", citeKey: "x", title: "X", path: "papers/ml/x", status: "unread", ...over });

describe("deriveBibPaperInput", () => {
  it("keeps the entry's key and carries its title, authors, year, venue, DOI and locators", () => {
    const input = deriveBibPaperInput(entry(`@article{vaswani17, title={Attention Is All You Need}, author={Vaswani, A. and Shazeer, N.}, year={2017},
      journal={NeurIPS}, doi={10.5555/3295222}, volume={30}, number={2}, pages={1--11}, url={https://x.org/a}}`), "refs.bib");
    expect(input).toEqual({
      citeKey: "vaswani17", sourceName: "refs.bib",
      fields: {
        title: "Attention Is All You Need", authors: ["Vaswani, A.", "Shazeer, N."], year: 2017, journal: "NeurIPS",
        url: "https://x.org/a", volume: "30", issue: "2", pages: "1--11", doi: "10.5555/3295222",
      },
    });
  });

  it("falls back to the key as the title and leaves out what the entry lacks", () => {
    expect(deriveBibPaperInput(entry("@misc{bare}"), "a.bib").fields).toEqual({ title: "bare" });
  });
});

describe("readBibIdentifier", () => {
  it("prefers the DOI, then the arXiv id from eprint or url", () => {
    expect(readBibIdentifier(entry("@article{a, doi={10.1000/abc}, eprint={1706.03762}}"))).toBe("10.1000/abc");
    expect(readBibIdentifier(entry("@article{a, eprint={1706.03762v2}}"))).toBe("arXiv:1706.03762");
    expect(readBibIdentifier(entry("@article{a, url={https://arxiv.org/abs/1706.03762}}"))).toBe("arXiv:1706.03762");
    expect(readBibIdentifier(entry("@article{a, title={T}}"))).toBeUndefined();
  });
});

describe("createPaperFromBibEntry", () => {
  it("writes a paper without a PDF into the target folder under the entry's key", async () => {
    const writePaperArtifacts = jest.fn(async () => {});
    const ctx = {
      fs: { exists: async () => false, writeFile: jest.fn(async () => {}) }, artifacts: { writePaperArtifacts },
      paths: { join: (...parts: string[]) => parts.join("/") },
    };
    const record = await createPaperFromBibEntry(ctx as never, [], "/lib/papers/refs", entry("@article{k1, title={T}, year={2020}}"), "refs.bib");
    expect(record).toMatchObject({ id: "k1", citeKey: "k1", path: "/lib/papers/refs/k1", hasPdf: false, title: "T", year: 2020 });
    expect(writePaperArtifacts).toHaveBeenCalledWith("/lib/papers/refs/k1", expect.objectContaining({ id: "k1" }), "refs.bib");
  });
});

describe("planBibImport", () => {
  const entries = parseBibEntries(`
    @article{new1, title={One}, doi={10.1000/NEW}}
    @article{sameDoi, title={Two}, doi={10.1000/Held}}
    @misc{sameArxiv, title={Three}, eprint={1706.03762}}
    @article{HeldKey, title={Four}}
    @article{again, title={Five}, doi={10.1000/new}}
    @article{plain, title={Six}}`);
  const library = [
    paper({ id: "p1", citeKey: "p1", doi: "10.1000/held" }),
    paper({ id: "p2", citeKey: "p2", url: "https://arxiv.org/abs/1706.03762" }),
    paper({ id: "heldkey", citeKey: "heldkey" }),
  ];

  it("skips entries whose DOI, arXiv id or cite key the library has, ignoring case, and reports the matching paper", () => {
    const plan = planBibImport(entries, library);
    expect(plan.existing).toEqual([
      { key: "sameDoi", id: "p1" }, { key: "sameArxiv", id: "p2" }, { key: "HeldKey", id: "heldkey" }, { key: "again", id: "new1" },
    ]);
    expect(plan.fresh.map((e) => e.key)).toEqual(["new1", "plain"]);
  });

  it("holds an entry that repeats an earlier key of the same file", () => {
    const plan = planBibImport(parseBibEntries("@misc{a, title={A}} @misc{A, title={A2}}"), []);
    expect(plan.fresh.map((e) => e.key)).toEqual(["a"]);
    expect(plan.existing).toEqual([{ key: "A", id: "a" }]);
  });
});

describe("deriveImportFolderName", () => {
  it("names the folder after the file without its extension", async () => {
    expect(await deriveImportFolderName("/home/me/My Refs.bib", () => false)).toBe("My Refs");
  });

  it("numbers a name that is taken and makes the name safe for a folder", async () => {
    const taken = new Set(["refs", "refs 2"]);
    expect(await deriveImportFolderName("refs.BIB", (name) => taken.has(name))).toBe("refs 3");
    expect(await deriveImportFolderName("a:b*c.bib", () => false)).toBe("a-b-c");
    expect(await deriveImportFolderName(".bib", () => false)).toBe("Imported references");
  });
});

describe("display helpers", () => {
  it("joins folder segments with ' › ' and words the closing message", () => {
    expect(formatLibraryFolder("ml/nets")).toBe("ml › nets");
    expect(describeBibImport(12, "refs", 3)).toBe("Imported 12 references into refs (3 already in your library).");
    expect(describeBibImport(1, "refs", 0)).toBe("Imported 1 reference into refs (0 already in your library).");
  });

  it("counts the papers of each linked folder, subfolders included", () => {
    const papers = [paper({ path: "papers/ml/a" }), paper({ path: "papers/ml/nets/b" }), paper({ path: "papers/other/c" })];
    expect(countLinkedFolders(papers, ["ml", "ml/nets", "gone"])).toEqual([
      { folder: "ml", papers: 2 }, { folder: "ml/nets", papers: 1 }, { folder: "gone", papers: 0 },
    ]);
    expect(countLinkedFolders(papers, undefined)).toEqual([]);
  });
});
