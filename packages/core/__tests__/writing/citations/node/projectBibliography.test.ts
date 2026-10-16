/** Verifies that a project's labshelf.bib follows its citations and the main file loads it once. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PaperRecord } from "../../../../src/model/index";
import { BIBLIOGRAPHY_HEADER } from "../../../../src/writing/citations/index";
import { projectCitationKeys, updateProjectBibliography } from "../../../../src/writing/citations/node/index";
import type { ProjectFormat } from "../../../../src/writing/project/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const papers: PaperRecord[] = ["smith2020", "doe2021"].map((id) => ({
  id, citeKey: id, title: `Title ${id}`, path: `/lib/papers/${id}`, status: "unread",
}));

async function folderWith(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), text);
  }
  return dir;
}

const read = (dir: string, name: string): Promise<string> => fs.readFile(path.join(dir, name), "utf8");
const project = (folder: string, format: ProjectFormat, main: string, bibliography?: string) =>
  ({ folder, main, settings: { id: "p", format, bibliography } });

describe("projectCitationKeys", () => {
  it("reads every source file of the format, skipping hidden folders and node_modules", async () => {
    const dir = await folderWith({
      "main.tex": "\\cite{a}", "chapters/one.tex": "\\cite{b}", "notes.typ": "@c",
      ".git/x.tex": "\\cite{d}", "node_modules/y.tex": "\\cite{e}",
    });
    expect((await projectCitationKeys(dir, "latex")).sort()).toEqual(["a", "b"]);
  });
});

describe("updateProjectBibliography", () => {
  it("writes labshelf.bib, loads it from main.tex and records it in labshelf.yaml on the first citation", async () => {
    const main = "\\begin{document}\n\\cite{smith2020,unknown}\n\\end{document}\n";
    const dir = await folderWith({ "labshelf.yaml": "id: p\nformat: latex\n", "main.tex": main });
    const result = await updateProjectBibliography(project(dir, "latex", "main.tex"), papers, fakeLogger());
    expect(result).toEqual({ written: true, papersWritten: true, missing: ["unknown"], mainLine: "added" });
    expect(await read(dir, "labshelf.bib")).toContain("@article{smith2020,");
    expect(await read(dir, "main.tex")).toContain("\\bibliography{labshelf}");
    expect(await read(dir, "labshelf.yaml")).toBe(
      "id: p\nformat: latex\nbibliography: labshelf.bib\npapers:\n  - key: smith2020\n    cited: true\n",
    );
  });

  it("does not rewrite an unchanged file and does not touch the main file again", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: p\nformat: latex\n", "main.tex": "\\cite{doe2021}" });
    await updateProjectBibliography(project(dir, "latex", "main.tex"), papers, fakeLogger());
    const again = await updateProjectBibliography(project(dir, "latex", "main.tex", "labshelf.bib"), papers, fakeLogger());
    expect(again).toEqual({ written: false, papersWritten: false, missing: [], mainLine: "not-needed" });
  });

  it("creates nothing while the project cites no library paper", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "main.typ": "@fig:one" });
    const result = await updateProjectBibliography(project(dir, "typst", "main.typ"), papers, fakeLogger());
    expect(result).toMatchObject({ written: false, missing: ["fig:one"], mainLine: "not-needed" });
    await expect(fs.stat(path.join(dir, "labshelf.bib"))).rejects.toThrow();
    expect(await read(dir, "main.typ")).toBe("@fig:one");
  });

  it("empties labshelf.bib to its header when the last citation is removed", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\nbibliography: labshelf.bib\n", "main.typ": "", "labshelf.bib": "old" });
    const result = await updateProjectBibliography(project(dir, "typst", "main.typ", "labshelf.bib"), papers, fakeLogger());
    expect(result.written).toBe(true);
    expect(await read(dir, "labshelf.bib")).toBe(`${BIBLIOGRAPHY_HEADER}\n`);
  });

  it("leaves a Typst main that loads another bibliography for the user to extend", async () => {
    const main = "@smith2020\n#bibliography(\"refs.bib\")\n";
    const dir = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "main.typ": main });
    const result = await updateProjectBibliography(project(dir, "typst", "main.typ"), papers, fakeLogger());
    expect(result.mainLine).toBe("conflict");
    expect(await read(dir, "main.typ")).toBe(main);
  });
});

describe("updateProjectBibliography with open editors", () => {
  it("reads unsaved text and edits an open main file in the editor, not on disk", async () => {
    const dir = await folderWith({ "labshelf.yaml": "id: p\nformat: typst\n", "main.typ": "= Intro\n" });
    const mainPath = path.join(dir, "main.typ");
    const edits: Array<[string, string]> = [];
    const open = {
      text: (file: string) => (file === mainPath ? "= Intro\n@doe2021\n" : undefined),
      replace: async (file: string, text: string) => { edits.push([file, text]); return true; },
    };
    const result = await updateProjectBibliography(project(dir, "typst", "main.typ"), papers, fakeLogger(), open);
    expect(result).toMatchObject({ written: true, mainLine: "added" });
    expect(edits).toEqual([[mainPath, "= Intro\n@doe2021\n\n#bibliography(\"labshelf.bib\")\n"]]);
    expect(await read(dir, "main.typ")).toBe("= Intro\n");
  });
});
