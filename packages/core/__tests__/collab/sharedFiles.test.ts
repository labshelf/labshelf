/**
 * Verifies which project files a share holds and which of them are text docs.
 * Verifies the split of labshelf.yaml into shared settings and the per-user keys each copy keeps.
 * Pins that a file doc's text changes by one minimal edit around the common prefix and suffix.
 * Verifies which index paths from peers are safe to write below a project folder.
 * Verifies the merge of one member's generated labshelf.bib into the shared one.
 */
import {
  deriveSharedFileKind,
  deriveSharedPaths,
  applySharedSettings,
  readSettingsMap,
  parseSharedSettings,
  writeSettingsMap,
  readFileText,
  setFileText,
  isSafeSharePath,
  mergeGeneratedBibliography,
} from "../../src/collab/index";
import * as Y from "yjs";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("deriveSharedPaths", () => {
  it("shares sources, figures and labshelf.bib but not labshelf.yaml, build output or VCS folders", () => {
    const list = [
      "labshelf.yaml", "labshelf.bib", "main.tex", "main.aux", "main.log", "main.synctex.gz", "main.pdf",
      "fig/plot.pdf", "refs.bib", ".git/HEAD", "sub/.svn/entries",
    ];
    expect(deriveSharedPaths(list)).toEqual(["labshelf.bib", "main.tex", "fig/plot.pdf", "refs.bib"]);
  });

  it("admits only the checklist of .labshelf/, because comments travel in the index doc", () => {
    const list = [".labshelf/checklist.json", ".labshelf/comments.json", ".labshelf/state.json", "sub/.labshelf/checklist.json"];
    expect(deriveSharedPaths(list)).toEqual([".labshelf/checklist.json"]);
  });

  it("drops the built PDF of a Typst root in a subfolder", () => {
    expect(deriveSharedPaths(["ch/a.typ", "ch/a.pdf", "ch/b.pdf"])).toEqual(["ch/a.typ", "ch/b.pdf"]);
  });
});

describe("deriveSharedFileKind", () => {
  it("makes UTF-8 files with a text extension text docs", () => {
    expect(deriveSharedFileKind("main.tex", utf8("café"))).toBe("text");
    expect(deriveSharedFileKind(".labshelf/checklist.json", utf8("{}"))).toBe("text");
  });

  it("makes other extensions and invalid UTF-8 blobs", () => {
    expect(deriveSharedFileKind("fig.png", utf8("png"))).toBe("blob");
    expect(deriveSharedFileKind("main.tex", new Uint8Array([0x63, 0xe9]))).toBe("blob");
  });
});

const LOCAL = [
  "# my project",
  "id: paper-a",
  "format: latex",
  "main: main.tex # entry",
  "folder: Thesis",
  "archived: true",
  "trashed: 2026-10-01T00:00:00.000Z",
  "shared: s-1",
  "engine: xelatex",
  "colour: blue",
  "",
].join("\n");

describe("parseSharedSettings", () => {
  it("takes the shared keys and leaves per-user and unknown keys out", () => {
    expect(parseSharedSettings(LOCAL)).toEqual({ format: "latex", main: "main.tex", engine: "xelatex" });
  });

  it("reads nested keys as plain values", () => {
    const text = "id: a\nformat: typst\ntypst: '0.13'\ncheck:\n  pages: 8\nvalues: [v.json]\n";
    expect(parseSharedSettings(text)).toEqual({ format: "typst", typst: "0.13", check: { pages: 8 }, values: ["v.json"] });
  });

  it("throws on text that is not YAML", () => {
    expect(() => parseSharedSettings("a: [")).toThrow(/labshelf\.yaml/);
  });
});

describe("applySharedSettings", () => {
  it("writes shared keys and keeps per-user keys, comments and unknown keys", () => {
    const next = applySharedSettings(LOCAL, { format: "latex", main: "paper.tex", engine: "xelatex", title: "Shared title" });
    expect(next).toContain("# my project");
    expect(next).toContain("id: paper-a");
    expect(next).toContain("folder: Thesis");
    expect(next).toContain("archived: true");
    expect(next).toContain("shared: s-1");
    expect(next).toContain("colour: blue");
    expect(next).toContain("main: paper.tex");
    expect(next).toContain("title: Shared title");
    expect(parseSharedSettings(next)).toEqual({ format: "latex", main: "paper.tex", engine: "xelatex", title: "Shared title" });
  });

  it("removes a shared key absent from the shared settings", () => {
    const next = applySharedSettings(LOCAL, { format: "latex", main: "main.tex" });
    expect(next).not.toContain("engine:");
    expect(next).toContain("main: main.tex # entry");
  });

  it("does not take per-user keys from the shared settings", () => {
    const next = applySharedSettings(LOCAL, { format: "latex", id: "other", folder: "Elsewhere" } as Record<string, unknown>);
    expect(next).toContain("id: paper-a");
    expect(next).toContain("folder: Thesis");
  });
});

describe("settings map", () => {
  it("round-trips the shared settings through the index doc and removes dropped keys", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("settings");
    writeSettingsMap(map, { format: "latex", main: "main.tex", check: { pages: 8 } });
    writeSettingsMap(map, { format: "latex", check: { pages: 10 } });
    expect(readSettingsMap(map)).toEqual({ format: "latex", check: { pages: 10 } });
  });

  it("leaves an unchanged key alone so no update is sent", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("settings");
    writeSettingsMap(map, { format: "latex", main: "main.tex" });
    let updates = 0;
    doc.on("update", () => { updates += 1; });
    writeSettingsMap(map, { format: "latex", main: "main.tex" });
    expect(updates).toBe(0);
  });
});

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc();
  readFileText(doc).insert(0, text);
  return doc;
}

describe("setFileText", () => {
  it("changes only the differing middle, in one transaction with the given origin", () => {
    const before = "a".repeat(5000) + "OLD" + "b".repeat(5000);
    const doc = docWith(before);
    const updates: { update: Uint8Array; origin: unknown }[] = [];
    doc.on("update", (update: Uint8Array, origin: unknown) => updates.push({ update, origin }));
    const deltas: unknown[] = [];
    readFileText(doc).observe((event: Y.YTextEvent) => deltas.push(event.delta));
    setFileText(doc, "a".repeat(5000) + "NEW!" + "b".repeat(5000), "disk");
    expect(readFileText(doc).toString()).toBe("a".repeat(5000) + "NEW!" + "b".repeat(5000));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.origin).toBe("disk");
    expect(updates[0]!.update.length).toBeLessThan(100);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toHaveLength(3);
    expect(deltas[0]).toEqual(expect.arrayContaining([{ retain: 5000 }, { insert: "NEW!" }, { delete: 3 }]));
  });

  it("makes no update when the text is unchanged", () => {
    const doc = docWith("same");
    const updates = jest.fn();
    doc.on("update", updates);
    setFileText(doc, "same", "disk");
    expect(updates).not.toHaveBeenCalled();
  });

  it("never splits a surrogate pair", () => {
    const doc = docWith("x\u{1F600}y");
    setFileText(doc, "x\u{1F601}y", "disk");
    expect(readFileText(doc).toString()).toBe("x\u{1F601}y");
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(readFileText(copy).toString()).toBe("x\u{1F601}y");
  });
});

describe("isSafeSharePath", () => {
  it.each(["main.typ", "fig/plot.pdf", "a/b/c.tex", "labshelf.bib", ".labshelf/checklist.json", "notes/.hidden", "dir.d/file", "my.con/x", "console.txt"])(
    "accepts %s", (path) => { expect(isSafeSharePath(path)).toBe(true); });

  it.each([
    "", "/etc/passwd", "\\win", "a\\b", "../x", "a/../x", "a/..", "./x", "a/./b", "a//b", "a/", "a\0b", "C:/x", "c:x", "C:\\x",
    "CON", "con.txt", "a/NUL", "a/com1.log", "LPT9", "aux.tex", "a/prn", "a/name.", "a/name ",
    "labshelf.yaml", ".labshelf/comments.json", ".labshelf/secret.json", ".labshelf",
    "LabShelf.yaml", ".LABSHELF/comments.json", ".Labshelf/x", ".Labshelf/checklist.json",
  ])("rejects %j", (path) => { expect(isSafeSharePath(path)).toBe(false); });

  it("rejects values that are not strings", () => {
    expect(isSafeSharePath(undefined as unknown as string)).toBe(false);
  });
});

const HEADER = "% Generated by LabShelf from the library papers this project cites. Edits are overwritten.";
const bib = (...entries: string[]): string => [HEADER, ...entries].join("\n\n") + "\n";

const VASWANI = "@article{vaswani2017,\n  title = {Attention},\n  doi = {10.5555/attn}\n}";
const VASWANI_NEWER = "@article{vaswani2017,\n  title = {Attention Is All You Need},\n  doi = {10.5555/ATTN}\n}";
const SMITH = "@article{smith2020,\n  title = {Smith},\n  doi = {10.1000/smith}\n}";

describe("mergeGeneratedBibliography", () => {
  it("keeps an entry the collaborator's library lacks", () => {
    const shared = bib(VASWANI, SMITH);
    expect(mergeGeneratedBibliography(shared, bib(VASWANI))).toEqual({ text: shared, clashes: [] });
  });

  it("adds an entry the shared file lacks after the existing ones", () => {
    const result = mergeGeneratedBibliography(bib(VASWANI), bib(VASWANI, SMITH));
    expect(result).toEqual({ text: bib(VASWANI, SMITH), clashes: [] });
  });

  it("updates an entry with the same DOI, ignoring case", () => {
    const result = mergeGeneratedBibliography(bib(VASWANI, SMITH), bib(VASWANI_NEWER));
    expect(result).toEqual({ text: bib(VASWANI_NEWER, SMITH), clashes: [] });
  });

  it("keeps the shared entry and reports a clash when the same key names another DOI", () => {
    const other = "@article{smith2020,\n  title = {Other Smith},\n  doi = {10.2000/other}\n}";
    const shared = bib(SMITH);
    expect(mergeGeneratedBibliography(shared, bib(other))).toEqual({
      text: shared, clashes: [{ key: "smith2020", sharedId: "doi:10.1000/smith", localId: "doi:10.2000/other" }],
    });
  });

  it("reports a clash when the DOIs differ even though the arXiv ids match", () => {
    const shared = "@article{bert,\n  doi = {10.1000/a},\n  eprint = {1810.04805}\n}";
    const local = "@article{bert,\n  doi = {10.2000/b},\n  eprint = {1810.04805}\n}";
    expect(mergeGeneratedBibliography(bib(shared), bib(local)).clashes).toHaveLength(1);
  });

  it("updates an entry with the same arXiv id from eprint, url or an arXiv DOI", () => {
    const shared = "@misc{bert,\n  title = {BERT},\n  doi = {10.48550/arXiv.1810.04805}\n}";
    const local = "@article{bert,\n  title = {BERT, published},\n  doi = {10.18653/v1/N19-1423},\n  eprint = {1810.04805v2}\n}";
    expect(mergeGeneratedBibliography(bib(shared), bib(local))).toEqual({ text: bib(local), clashes: [] });
  });

  it("updates a shared entry that has neither DOI nor arXiv id", () => {
    const shared = "@book{knuth,\n  title = {TAOCP}\n}";
    const local = "@book{knuth,\n  title = {The Art of Computer Programming},\n  doi = {10.9000/knuth}\n}";
    expect(mergeGeneratedBibliography(bib(shared), bib(local))).toEqual({ text: bib(local), clashes: [] });
  });

  it("reports a clash when the local entry has no id but the shared one has", () => {
    const local = "@article{smith2020,\n  title = {Smith}\n}";
    expect(mergeGeneratedBibliography(bib(SMITH), bib(local)).clashes)
      .toEqual([{ key: "smith2020", sharedId: "doi:10.1000/smith", localId: undefined }]);
  });

  it("keeps comments and hand-written text around untouched entries byte for byte", () => {
    const shared = `${HEADER}\n\n% kept by hand\n@string{acl = {ACL}}\n\n${VASWANI}\n\n${SMITH}  % trailing\n`;
    const result = mergeGeneratedBibliography(shared, bib(VASWANI_NEWER));
    expect(result.text).toBe(`${HEADER}\n\n% kept by hand\n@string{acl = {ACL}}\n\n${VASWANI_NEWER}\n\n${SMITH}  % trailing\n`);
  });

  it("takes the generated text whole when the shared file is empty", () => {
    expect(mergeGeneratedBibliography("", bib(SMITH))).toEqual({ text: bib(SMITH), clashes: [] });
  });
});
