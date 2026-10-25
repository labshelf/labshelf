/** Verifies that labshelf.yaml's papers list is written once per change, keeps manual entries and foreign DOIs, and never touches a broken file. */
import { updateProjectBibliography, type PaperRecord } from "@labshelf/core";

import { memoryCatalog, readText, writeTree, type MemoryCatalog } from "../../support/memoryProjectCatalog";

const DIR = "/p";
const papers: PaperRecord[] = [
  { id: "smith2020", citeKey: "smith2020", title: "S", path: "/s", status: "unread", doi: "10.1/smith" },
  { id: "doe2021", citeKey: "doe2021", title: "D", path: "/d", status: "unread", doi: "10.1/doe" },
];
const project = { folder: DIR, main: "main.typ", settings: { id: "p", format: "typst" as const, bibliography: "labshelf.bib" } };

async function projectWith(yaml: string, main: string): Promise<MemoryCatalog> {
  const context = memoryCatalog();
  await writeTree(context.fs, DIR, { "labshelf.yaml": yaml, "main.typ": main });
  return context;
}
const yamlOf = (context: MemoryCatalog) => readText(context.fs, `${DIR}/labshelf.yaml`);

describe("updateProjectBibliography papers sync", () => {
  it("writes the cited papers with their DOI once and not again on an identical run", async () => {
    const context = await projectWith("id: p\nformat: typst\nbibliography: labshelf.bib\n", "@doe2021 @smith2020");
    expect((await updateProjectBibliography(context, project, papers)).papersWritten).toBe(true);
    const first = yamlOf(context);
    expect(first).toContain("  - key: doe2021\n    doi: 10.1/doe\n    cited: true\n");
    expect((await updateProjectBibliography(context, project, papers)).papersWritten).toBe(false);
    expect(yamlOf(context)).toBe(first);
    expect(context.logger.logs.filter((log) => log.message === "project settings updated")).toHaveLength(1);
  });

  it("keeps a manual entry and a DOI the library does not share, and drops a cited entry that is no longer cited", async () => {
    const yaml = "id: p\nformat: typst\nbibliography: labshelf.bib\npapers:\n  - key: manual1\n  - key: smith2020\n    doi: 10.9/theirs\n    cited: true\n  - key: gone\n    cited: true\n";
    const context = await projectWith(yaml, "@smith2020");
    const result = await updateProjectBibliography(context, project, papers);
    expect(result.papersWritten).toBe(true);
    const text = yamlOf(context);
    expect(text).toContain("key: manual1");
    expect(text).toContain("doi: 10.9/theirs");
    expect(text).not.toContain("gone");
  });

  it("drops the papers key when nothing is left", async () => {
    const context = await projectWith("id: p\nformat: typst\nbibliography: labshelf.bib\npapers:\n  - key: gone\n    cited: true\n", "");
    await updateProjectBibliography(context, project, papers);
    expect(yamlOf(context)).not.toContain("papers");
  });

  it("leaves a labshelf.yaml that does not parse untouched", async () => {
    const context = await projectWith("id: p\nformat: typst\npapers: nope\n", "@doe2021");
    await expect(updateProjectBibliography(context, project, papers)).rejects.toThrow("papers must be a list");
    expect(yamlOf(context)).toBe("id: p\nformat: typst\npapers: nope\n");
  });
});
