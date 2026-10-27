/** Verifies the newest-source-edit time of a project folder. */
import { posixPathOps } from "../../../../src/path/index";
import { readLastModified } from "../../../../src/writing/project/folder/index";
import { MemoryLibraryFs } from "../../../support/memoryLibraryFs";

describe("readLastModified", () => {
  it("is the newest mtime among source files and ignores other files", async () => {
    const fs = new MemoryLibraryFs();
    for (const [file, mtime] of [["main.tex", 100], ["sec/ref.BIB", 300], ["labshelf.yaml", 200], ["out.pdf", 900], [".git/x.tex", 800]] as const) {
      await fs.writeText(`/p/${file}`, "x");
      fs.mtimes.set(`/p/${file}`, mtime);
    }
    expect(await readLastModified({ fs, paths: posixPathOps }, "/p")).toBe(300);
  });

  it("is undefined when the folder has no source files", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText("/p/out.pdf", "x");
    expect(await readLastModified({ fs, paths: posixPathOps }, "/p")).toBeUndefined();
  });
});
