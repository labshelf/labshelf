/** Verifies the project file walk: nested files are listed relative and sorted, hidden folders and node_modules are not. */
import { posixPathOps } from "../../../../src/path/index";
import { listProjectFiles } from "../../../../src/writing/project/folder/index";
import { MemoryLibraryFs } from "../../../support/memoryLibraryFs";

describe("listProjectFiles", () => {
  it("lists nested files relative to the folder, sorted, and skips hidden folders and node_modules", async () => {
    const fs = new MemoryLibraryFs();
    for (const file of ["a.tex", "sec/b.tex", ".git/c.tex", "node_modules/d/e.tex", ".hidden.tex", "sec/deep/z.tex"]) {
      await fs.writeText(`/p/${file}`, "x");
    }
    expect(await listProjectFiles({ fs, paths: posixPathOps }, "/p")).toEqual([".hidden.tex", "a.tex", "sec/b.tex", "sec/deep/z.tex"]);
  });

  it("rejects when the folder does not exist", async () => {
    await expect(listProjectFiles({ fs: new MemoryLibraryFs(), paths: posixPathOps }, "/gone")).rejects.toThrow(/not found/);
  });
});
