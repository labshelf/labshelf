/** Verifies that labshelf.yaml's papers list is written once per change, keeps manual entries and foreign DOIs, and never touches a broken file. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PaperRecord } from "../../../../src/model/index";
import { updateProjectBibliography } from "../../../../src/writing/citations/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const papers: PaperRecord[] = [
  { id: "smith2020", citeKey: "smith2020", title: "S", path: "/s", status: "unread", doi: "10.1/smith" },
  { id: "doe2021", citeKey: "doe2021", title: "D", path: "/d", status: "unread", doi: "10.1/doe" },
];

async function projectWith(yaml: string, main: string) {
  const folder = await makeTempDir();
  await fs.writeFile(path.join(folder, "labshelf.yaml"), yaml);
  await fs.writeFile(path.join(folder, "main.typ"), main);
  return { folder, main: "main.typ", settings: { id: "p", format: "typst" as const, bibliography: "labshelf.bib" } };
}
const yamlOf = (folder: string) => fs.readFile(path.join(folder, "labshelf.yaml"), "utf8");

describe("updateProjectBibliography papers sync", () => {
  it("writes the cited papers with their DOI once and not again on an identical run", async () => {
    const project = await projectWith("id: p\nformat: typst\nbibliography: labshelf.bib\n", "@doe2021 @smith2020");
    const logger = fakeLogger();
    expect((await updateProjectBibliography(project, papers, logger)).papersWritten).toBe(true);
    const first = await yamlOf(project.folder);
    expect(first).toContain("  - key: doe2021\n    doi: 10.1/doe\n    cited: true\n");
    expect((await updateProjectBibliography(project, papers, logger)).papersWritten).toBe(false);
    expect(await yamlOf(project.folder)).toBe(first);
    expect(logger.logs.filter((log) => log.message === "project settings updated")).toHaveLength(1);
  });

  it("keeps a manual entry and a DOI the library does not share, and drops a cited entry that is no longer cited", async () => {
    const yaml = "id: p\nformat: typst\nbibliography: labshelf.bib\npapers:\n  - key: manual1\n  - key: smith2020\n    doi: 10.9/theirs\n    cited: true\n  - key: gone\n    cited: true\n";
    const project = await projectWith(yaml, "@smith2020");
    const result = await updateProjectBibliography(project, papers, fakeLogger());
    expect(result.papersWritten).toBe(true);
    const text = await yamlOf(project.folder);
    expect(text).toContain("key: manual1");
    expect(text).toContain("doi: 10.9/theirs");
    expect(text).not.toContain("gone");
  });

  it("drops the papers key when nothing is left, and leaves a labshelf.yaml that does not parse untouched", async () => {
    const project = await projectWith("id: p\nformat: typst\nbibliography: labshelf.bib\npapers:\n  - key: gone\n    cited: true\n", "");
    await updateProjectBibliography(project, papers, fakeLogger());
    expect(await yamlOf(project.folder)).not.toContain("papers");

    const broken = await projectWith("id: p\nformat: typst\npapers: nope\n", "@doe2021");
    await expect(updateProjectBibliography(broken, papers, fakeLogger())).rejects.toThrow("papers must be a list");
    expect(await yamlOf(broken.folder)).toBe("id: p\nformat: typst\npapers: nope\n");
  });
});
