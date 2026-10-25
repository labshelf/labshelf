/** Verifies that the backlink index covers every ready project's sources and survives an unreadable one. */
import { posixPathOps } from "../../../src/library/index";
import { projectBacklinks } from "../../../src/writing/citations";
import type { ProjectEntry } from "../../../src/writing/project/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

async function folderWith(fs: MemoryLibraryFs, folder: string, files: Record<string, string>): Promise<string> {
  await fs.ensureDir(folder);
  for (const [name, text] of Object.entries(files)) { await fs.writeText(`${folder}/${name}`, text); }
  return folder;
}

const ready = (id: string, folder: string, format: "latex" | "typst"): ProjectEntry =>
  ({ kind: "ready", folder, location: "library", settings: { id, format }, main: undefined }) as ProjectEntry;

describe("projectBacklinks", () => {
  it("indexes each ready project's sources with paths relative to the project", async () => {
    const fs = new MemoryLibraryFs();
    const thesis = await folderWith(fs, "/lib/thesis", { "main.tex": "\\section{Intro}\n\\cite{k}", "ch/two.tex": "\\cite{k,j}" });
    const notes = await folderWith(fs, "/lib/notes", { "main.typ": "= Notes\n@k" });
    const broken: ProjectEntry = { kind: "broken", folder: thesis, location: "library", reason: "bad yaml" };
    const index = await projectBacklinks({ fs, paths: posixPathOps, logger: fakeLogger() }, [ready("thesis", thesis, "latex"), ready("notes", notes, "typst"), broken]);
    expect(index.get("k")).toEqual(expect.arrayContaining([
      { project: "thesis", file: "main.tex", line: 1, section: "Intro" },
      { project: "thesis", file: "ch/two.tex", line: 0, section: undefined },
      { project: "notes", file: "main.typ", line: 1, section: "Notes" },
    ]));
    expect(index.get("k")).toHaveLength(3);
    expect(index.get("j")).toEqual([{ project: "thesis", file: "ch/two.tex", line: 0, section: undefined }]);
  });

  it("prefers an open editor's text over the disk", async () => {
    const fs = new MemoryLibraryFs();
    const dir = await folderWith(fs, "/lib/p", { "main.tex": "\\cite{old}" });
    const open = { text: (file: string) => (file === `${dir}/main.tex` ? "\\cite{new}" : undefined), replace: async () => false };
    const index = await projectBacklinks({ fs, paths: posixPathOps, logger: fakeLogger() }, [ready("p", dir, "latex")], open);
    expect([...index.keys()]).toEqual(["new"]);
  });

  it("logs and skips a project whose folder is gone", async () => {
    const fs = new MemoryLibraryFs();
    const dir = await folderWith(fs, "/lib/p", { "main.tex": "\\cite{a}" });
    const logger = fakeLogger();
    const index = await projectBacklinks({ fs, paths: posixPathOps, logger }, [ready("gone", "/lib/missing", "latex"), ready("p", dir, "latex")]);
    expect([...index.keys()]).toEqual(["a"]);
    expect(logger.logs).toContainEqual({ level: "WARN", module: "backlinks", message: "project sources unreadable" });
  });
});
