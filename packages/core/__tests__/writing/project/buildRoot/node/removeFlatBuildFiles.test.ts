/** Verifies the removal of flat build files from the top of a project build folder. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { clearFlatBuildFiles } from "../../../../../src/writing/project/buildRoot/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

describe("clearFlatBuildFiles", () => {
  it("removes flat files of the root's base and keeps other bases and folders", async () => {
    const dir = await makeTempDir();
    for (const name of ["main.aux", "main.log", "main.synctex.gz", "main.pdf", "other.aux"]) {
      await fs.writeFile(path.join(dir, name), "x");
    }
    await fs.mkdir(path.join(dir, "main.tex"));
    await fs.writeFile(path.join(dir, "main.tex", "main.pdf"), "x");
    const logger = fakeLogger();

    await clearFlatBuildFiles(dir, "main.tex", logger);

    expect((await fs.readdir(dir)).sort()).toEqual(["main.tex", "other.aux"]);
    expect(await fs.readdir(path.join(dir, "main.tex"))).toEqual(["main.pdf"]);
    expect(logger.logs.length).toBeGreaterThan(0);
  });

  it("does nothing when the build dir does not exist", async () => {
    const dir = path.join(await makeTempDir(), "missing");
    await expect(clearFlatBuildFiles(dir, "main.tex", fakeLogger())).resolves.toBeUndefined();
  });
});
