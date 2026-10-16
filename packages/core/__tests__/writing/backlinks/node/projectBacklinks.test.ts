/** Verifies that the backlink index covers every ready project's sources and survives an unreadable one. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { projectBacklinks } from "../../../../src/writing/backlinks/node/index";
import type { ProjectEntry } from "../../../../src/writing/project/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function folderWith(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), text);
  }
  return dir;
}

const ready = (id: string, folder: string, format: "latex" | "typst"): ProjectEntry =>
  ({ kind: "ready", folder, location: "library", settings: { id, format }, main: undefined }) as ProjectEntry;

describe("projectBacklinks", () => {
  it("indexes each ready project's sources with paths relative to the project", async () => {
    const thesis = await folderWith({ "main.tex": "\\section{Intro}\n\\cite{k}", "ch/two.tex": "\\cite{k,j}" });
    const notes = await folderWith({ "main.typ": "= Notes\n@k" });
    const broken: ProjectEntry = { kind: "broken", folder: thesis, location: "library", reason: "bad yaml" };
    const index = await projectBacklinks([ready("thesis", thesis, "latex"), ready("notes", notes, "typst"), broken], fakeLogger());
    expect(index.get("k")).toEqual(expect.arrayContaining([
      { project: "thesis", file: "main.tex", line: 1, section: "Intro" },
      { project: "thesis", file: "ch/two.tex", line: 0, section: undefined },
      { project: "notes", file: "main.typ", line: 1, section: "Notes" },
    ]));
    expect(index.get("k")).toHaveLength(3);
    expect(index.get("j")).toEqual([{ project: "thesis", file: "ch/two.tex", line: 0, section: undefined }]);
  });

  it("prefers an open editor's text over the disk", async () => {
    const dir = await folderWith({ "main.tex": "\\cite{old}" });
    const open = { text: (file: string) => (file === path.join(dir, "main.tex") ? "\\cite{new}" : undefined), replace: async () => false };
    const index = await projectBacklinks([ready("p", dir, "latex")], fakeLogger(), open);
    expect([...index.keys()]).toEqual(["new"]);
  });

  it("logs and skips a project whose folder is gone", async () => {
    const dir = await folderWith({ "main.tex": "\\cite{a}" });
    const logger = fakeLogger();
    const index = await projectBacklinks([ready("gone", path.join(dir, "missing"), "latex"), ready("p", dir, "latex")], logger);
    expect([...index.keys()]).toEqual(["a"]);
    expect(logger.logs).toContainEqual({ level: "WARN", module: "backlinks", message: "project sources unreadable" });
  });
});
