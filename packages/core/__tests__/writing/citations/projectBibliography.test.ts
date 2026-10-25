/** Verifies that a project's labshelf.bib follows its citations and the main file loads it once. */
import { BIBLIOGRAPHY_HEADER, listProjectCiteKeys, updateProjectBibliography, type PaperRecord, type ProjectFormat } from "@labshelf/core";

import { memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";

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
