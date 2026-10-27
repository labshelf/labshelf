/** Verifies parsing of .bib text, the generated labshelf.bib, the main file's bibliography line and the regeneration of the project's bibliography and papers list. */
import { parseBibEntries, BIBLIOGRAPHY_HEADER, createBibliography, withBibliographyLine } from "../../../src/writing/citations/index";
import type { PaperRecord } from "../../../src/model/index";
import { listProjectCiteKeys, updateProjectBibliography, type ProjectFormat } from "@labshelf/core";
import { memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";

describe("parseBibEntries", () => {
  it("reads braced, quoted, bare and concatenated values with lower-case names", () => {
    const text = `@Article{vaswani2017,\n  Title = {Attention {Is} All You Need},\n  journal = "NeurIPS {"}x{"}",\n  year = 2017,\n  month = jan # " 1",\n}`;
    const [entry] = parseBibEntries(text);
    expect(entry).toMatchObject({ type: "article", key: "vaswani2017", start: 0, end: text.length });
    expect(Object.fromEntries(entry!.fields)).toEqual({
      title: "Attention {Is} All You Need", journal: "NeurIPS {\"}x{\"}", year: "2017", month: "jan 1",
    });
  });

  it("skips @string, @comment, @preamble and commented-out entries", () => {
    const text = `@string{nips = "NeurIPS"}\n@comment{@article{no, title={x}}}\n% @article{off, title={y}}\n@preamble{"\\newcommand{\\x}{}"}\n@misc{kept, note = {n}}`;
    expect(parseBibEntries(text).map((entry) => entry.key)).toEqual(["kept"]);
  });

  it("accepts parenthesised entries and entries with only a key", () => {
    expect(parseBibEntries("@book(knuth, title = {TAOCP})\n@misc{bare}").map((entry) => [entry.type, entry.key])).toEqual([["book", "knuth"], ["misc", "bare"]]);
  });

  it("skips a malformed entry and parses the one after it", () => {
    const text = "@article{broken, title = {never closed\n@article{good, title = {Fine}}";
    expect(parseBibEntries(text).map((entry) => entry.key)).toEqual(["good"]);
  });

  it("gives offsets that cut the entry out of the text", () => {
    const text = "intro\n@misc{a, title={A}}\n\n@misc{b, title={B}}\n";
    const entries = parseBibEntries(text);
    expect(entries.map((entry) => text.slice(entry.start, entry.end))).toEqual(["@misc{a, title={A}}", "@misc{b, title={B}}"]);
  });
});

function paper(id: string, citeKey = id): PaperRecord {
  return { id, citeKey, title: `Title ${id}`, path: `/lib/papers/${id}`, status: "unread", authors: ["Ada Lovelace"], year: 2020 };
}

describe("createBibliography", () => {
  it("writes the header and the cited entries in key order, without file paths", () => {
    const result = createBibliography(["b", "a"], [paper("a"), paper("b"), paper("c")]);
    expect(result.text.startsWith(`${BIBLIOGRAPHY_HEADER}\n\n@article{a,`)).toBe(true);
    expect(result.text.indexOf("@article{a,")).toBeLessThan(result.text.indexOf("@article{b,"));
    expect(result.text).not.toContain("@article{c,");
    expect(result.text).not.toContain("file =");
    expect(result.text.endsWith("}\n")).toBe(true);
    expect(result.resolved).toEqual(["a", "b"]);
  });

  it("gives the same bytes for the same citations in any order", () => {
    const papers = [paper("a"), paper("b")];
    expect(createBibliography(["a", "b", "a"], papers).text).toBe(createBibliography(["b", "a"], [...papers].reverse()).text);
  });

  it("reports keys no library paper has and matches keys case-sensitively", () => {
    const result = createBibliography(["A", "fig:intro"], [paper("a")]);
    expect(result).toEqual({ text: `${BIBLIOGRAPHY_HEADER}\n`, resolved: [], missing: ["A", "fig:intro"] });
  });

  it("uses the paper with the smallest id when two papers share a cite key", () => {
    const result = createBibliography(["k"], [paper("zeta", "k"), paper("alpha", "k")]);
    expect(result.text).toContain("Title alpha");
    expect(result.text).not.toContain("Title zeta");
  });
});

describe("withBibliographyLine in LaTeX", () => {
  it("inserts style and bibliography before \\end{document}", () => {
    const result = withBibliographyLine("latex", "\\begin{document}\nx\n\\end{document}\n", "labshelf.bib");
    expect(result).toEqual({
      kind: "added",
      text: "\\begin{document}\nx\n\\bibliographystyle{plain}\n\\bibliography{labshelf}\n\n\\end{document}\n",
    });
  });

  it("appends to an existing \\bibliography list", () => {
    const result = withBibliographyLine("latex", "\\bibliography{refs}\n", "labshelf.bib");
    expect(result).toEqual({ kind: "added", text: "\\bibliography{refs,labshelf}\n" });
  });

  it("adds an \\addbibresource after the last one when biblatex is used", () => {
    const text = "\\addbibresource{a.bib}\n\\addbibresource{b.bib}\n\\begin{document}";
    expect(withBibliographyLine("latex", text, "labshelf.bib").text)
      .toBe("\\addbibresource{a.bib}\n\\addbibresource{b.bib}\n\\addbibresource{labshelf.bib}\n\\begin{document}");
  });

  it.each(["\\bibliography{refs, labshelf}", "\\addbibresource{labshelf.bib}"])("leaves %s as it is", (text) => {
    expect(withBibliographyLine("latex", text, "labshelf.bib")).toEqual({ kind: "present", text });
  });

  it("does not mistake a file whose name only contains the bibliography's name", () => {
    expect(withBibliographyLine("latex", "\\bibliography{mylabshelf_old}", "labshelf.bib").kind).toBe("added");
  });
});

describe("withBibliographyLine in Typst", () => {
  it("appends the call at the end", () => {
    expect(withBibliographyLine("typst", "= Intro\n", "labshelf.bib"))
      .toEqual({ kind: "added", text: "= Intro\n\n#bibliography(\"labshelf.bib\")\n" });
  });

  it("is present when the call already names the file", () => {
    const text = "#bibliography((\"refs.bib\", \"labshelf.bib\"))";
    expect(withBibliographyLine("typst", text, "labshelf.bib").kind).toBe("present");
  });

  it("reports a conflict and keeps the text when another bibliography is loaded", () => {
    const text = "#bibliography(\"refs.bib\")\n";
    expect(withBibliographyLine("typst", text, "labshelf.bib")).toEqual({ kind: "conflict", text });
  });
});

const DIR = "/p";
const papers: PaperRecord[] = ["smith2020", "doe2021"].map((id) => ({
  id, citeKey: id, title: `Title ${id}`, path: `/lib/papers/${id}`, status: "unread",
}));

async function folderWith(files: Record<string, string>): Promise<MemoryCatalog> {
  const context = memoryCatalog();
  await writeTree(context.fs, DIR, files);
  return context;
}

const read = (context: MemoryCatalog, name: string): string => readText(context.fs, `${DIR}/${name}`);
const project = (format: ProjectFormat, main: string, bibliography?: string) =>
  ({ folder: DIR, main, settings: { id: "p", format, bibliography } });

describe("listProjectCiteKeys", () => {
  it("reads every source file of the format, skipping hidden folders and node_modules", async () => {
    const context = await folderWith({
      "main.tex": "\\cite{a}", "chapters/one.tex": "\\cite{b}", "notes.typ": "@c",
      ".git/x.tex": "\\cite{d}", "node_modules/y.tex": "\\cite{e}",
    });
    expect((await listProjectCiteKeys(context, DIR, "latex")).sort()).toEqual(["a", "b"]);
  });
});

describe("updateProjectBibliography", () => {
  it("writes labshelf.bib, loads it from main.tex and records it in labshelf.yaml on the first citation", async () => {
    const main = "\\begin{document}\n\\cite{smith2020,unknown}\n\\end{document}\n";
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: latex\n", "main.tex": main });
    const result = await updateProjectBibliography(context, project("latex", "main.tex"), papers);
    expect(result).toEqual({ written: true, papersWritten: true, missing: ["unknown"], mainLine: "added" });
    expect(read(context, "labshelf.bib")).toContain("@article{smith2020,");
    expect(read(context, "main.tex")).toContain("\\bibliography{labshelf}");
    expect(read(context, "labshelf.yaml")).toBe(
      "id: p\nformat: latex\nbibliography: labshelf.bib\npapers:\n  - key: smith2020\n    cited: true\n",
    );
  });

  it("keeps the labshelf.yaml fields and comments it does not touch", async () => {
    const yaml = "# shared with Ana\nid: p\nformat: latex\nmain: main.tex\nengine: xelatex\npapers:\n  - key: manual1\n";
    const context = await folderWith({ "labshelf.yaml": yaml, "main.tex": "\\cite{doe2021}" });
    await updateProjectBibliography(context, project("latex", "main.tex"), papers);
    const text = read(context, "labshelf.yaml");
    expect(text.startsWith("# shared with Ana\nid: p\nformat: latex\nmain: main.tex\nengine: xelatex\n")).toBe(true);
    expect(text).toContain("  - key: manual1\n");
    expect(text).toContain("  - key: doe2021\n    cited: true\n");
    expect(text).toContain("bibliography: labshelf.bib\n");
  });

  it("does not rewrite an unchanged file and does not touch the main file again", async () => {
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: latex\n", "main.tex": "\\cite{doe2021}" });
    await updateProjectBibliography(context, project("latex", "main.tex"), papers);
    const again = await updateProjectBibliography(context, project("latex", "main.tex", "labshelf.bib"), papers);
    expect(again).toEqual({ written: false, papersWritten: false, missing: [], mainLine: "not-needed" });
  });

  it("creates nothing while the project cites no library paper", async () => {
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "main.typ": "@fig:one" });
    const result = await updateProjectBibliography(context, project("typst", "main.typ"), papers);
    expect(result).toMatchObject({ written: false, missing: ["fig:one"], mainLine: "not-needed" });
    expect(await context.fs.stat(`${DIR}/labshelf.bib`)).toBeUndefined();
    expect(read(context, "main.typ")).toBe("@fig:one");
  });

  it("empties labshelf.bib to its header when the last citation is removed", async () => {
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\nbibliography: labshelf.bib\n", "main.typ": "", "labshelf.bib": "old" });
    const result = await updateProjectBibliography(context, project("typst", "main.typ", "labshelf.bib"), papers);
    expect(result.written).toBe(true);
    expect(read(context, "labshelf.bib")).toBe(`${BIBLIOGRAPHY_HEADER}\n`);
  });

  it("leaves a Typst main that loads another bibliography for the user to extend", async () => {
    const main = "@smith2020\n#bibliography(\"refs.bib\")\n";
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "main.typ": main });
    const result = await updateProjectBibliography(context, project("typst", "main.typ"), papers);
    expect(result.mainLine).toBe("conflict");
    expect(read(context, "main.typ")).toBe(main);
  });

  it("loads labshelf.bib from a main file in a subfolder by a relative path", async () => {
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "src/main.typ": "@doe2021\n" });
    await updateProjectBibliography(context, project("typst", "src/main.typ"), papers);
    expect(read(context, "src/main.typ")).toContain("#bibliography(\"../labshelf.bib\")");
  });
});

describe("updateProjectBibliography with open editors", () => {
  it("reads unsaved text and edits an open main file in the editor, not on disk", async () => {
    const context = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "main.typ": "= Intro\n" });
    const mainPath = `${DIR}/main.typ`;
    const edits: Array<[string, string]> = [];
    const open = {
      text: (file: string) => (file === mainPath ? "= Intro\n@doe2021\n" : undefined),
      replace: async (file: string, text: string) => { edits.push([file, text]); return true; },
    };
    const result = await updateProjectBibliography(context, project("typst", "main.typ"), papers, open);
    expect(result).toMatchObject({ written: true, mainLine: "added" });
    expect(edits).toEqual([[mainPath, "= Intro\n@doe2021\n\n#bibliography(\"labshelf.bib\")\n"]]);
    expect(read(context, "main.typ")).toBe("= Intro\n");
  });
});

describe("updateProjectBibliography in a shared project", () => {
  const shared = (settings: { bibliography?: string }) =>
    ({ folder: DIR, main: "main.typ", settings: { id: "p", format: "typst" as const, shared: "a".repeat(32), ...settings } });

  it("adds its entries to the shared labshelf.bib, keeps the other members' and logs a clashing key", async () => {
    const others = "@article{ana2019,\n  title = {Ana's paper}\n}\n\n@article{smith2020,\n  doi = {10.1000/other}\n}\n";
    const context = await folderWith({
      "labshelf.yaml": "id: p\nformat: typst\nbibliography: labshelf.bib\n", "main.typ": "@smith2020 @doe2021\n", "labshelf.bib": others,
    });
    const withDoi = papers.map((paper) => (paper.id === "smith2020" ? { ...paper, doi: "10.1000/mine" } : paper));
    const result = await updateProjectBibliography(context, shared({ bibliography: "labshelf.bib" }), withDoi);
    const text = read(context, "labshelf.bib");
    expect(result.written).toBe(true);
    expect(text.startsWith(others.trimEnd())).toBe(true);
    expect(text).toContain("@article{doe2021,");
    expect(text).not.toContain("10.1000/mine");
    expect(context.logger.logs.some((entry) => entry.level === "WARN" && entry.module === "citations")).toBe(true);
  });
});

const listedPapers: PaperRecord[] = [
  { id: "smith2020", citeKey: "smith2020", title: "S", path: "/s", status: "unread", doi: "10.1/smith" },
  { id: "doe2021", citeKey: "doe2021", title: "D", path: "/d", status: "unread", doi: "10.1/doe" },
];
const typstProject = { folder: DIR, main: "main.typ", settings: { id: "p", format: "typst" as const, bibliography: "labshelf.bib" } };

async function projectWith(yaml: string, main: string): Promise<MemoryCatalog> {
  const context = memoryCatalog();
  await writeTree(context.fs, DIR, { "labshelf.yaml": yaml, "main.typ": main });
  return context;
}
const yamlOf = (context: MemoryCatalog) => readText(context.fs, `${DIR}/labshelf.yaml`);

describe("updateProjectBibliography papers sync", () => {
  it("writes the cited papers with their DOI once and not again on an identical run", async () => {
    const context = await projectWith("id: p\nformat: typst\nbibliography: labshelf.bib\n", "@doe2021 @smith2020");
    expect((await updateProjectBibliography(context, typstProject, listedPapers)).papersWritten).toBe(true);
    const first = yamlOf(context);
    expect(first).toContain("  - key: doe2021\n    doi: 10.1/doe\n    cited: true\n");
    expect((await updateProjectBibliography(context, typstProject, listedPapers)).papersWritten).toBe(false);
    expect(yamlOf(context)).toBe(first);
    expect(context.logger.logs.filter((log) => log.message === "project settings updated")).toHaveLength(1);
  });

  it("keeps a manual entry and a DOI the library does not share, and drops a cited entry that is no longer cited", async () => {
    const yaml = "id: p\nformat: typst\nbibliography: labshelf.bib\npapers:\n  - key: manual1\n  - key: smith2020\n    doi: 10.9/theirs\n    cited: true\n  - key: gone\n    cited: true\n";
    const context = await projectWith(yaml, "@smith2020");
    const result = await updateProjectBibliography(context, typstProject, listedPapers);
    expect(result.papersWritten).toBe(true);
    const text = yamlOf(context);
    expect(text).toContain("key: manual1");
    expect(text).toContain("doi: 10.9/theirs");
    expect(text).not.toContain("gone");
  });

  it("drops the papers key when nothing is left", async () => {
    const context = await projectWith("id: p\nformat: typst\nbibliography: labshelf.bib\npapers:\n  - key: gone\n    cited: true\n", "");
    await updateProjectBibliography(context, typstProject, listedPapers);
    expect(yamlOf(context)).not.toContain("papers");
  });

  it("leaves a labshelf.yaml that does not parse untouched", async () => {
    const context = await projectWith("id: p\nformat: typst\npapers: nope\n", "@doe2021");
    await expect(updateProjectBibliography(context, typstProject, listedPapers)).rejects.toThrow("papers must be a list");
    expect(yamlOf(context)).toBe("id: p\nformat: typst\npapers: nope\n");
  });
});
