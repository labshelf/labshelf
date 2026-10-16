/** Verifies the project file walk: nested files are listed, hidden folders and node_modules are not. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listProjectFiles } from "../../../../src/writing/project/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

describe("listProjectFiles", () => {
  it("lists nested files and skips hidden folders and node_modules", async () => {
    const dir = await makeTempDir();
    for (const file of ["a.tex", "sec/b.tex", ".git/c.tex", "node_modules/d/e.tex", ".hidden.tex"]) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), "x");
    }
    const files = (await listProjectFiles(dir)).map((file) => path.relative(dir, file).split(path.sep).join("/")).sort();
    expect(files).toEqual([".hidden.tex", "a.tex", "sec/b.tex"]);
  });
});
