/** Verifies that build problems are placed on project files and that the project folder itself is no file of the project. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { findProblems } from "../../../../src/latex/build/node/findProblems";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

describe("findProblems", () => {
  it("places a problem on the project file the log names", async () => {
    const folder = await makeTempDir();
    await fs.writeFile(path.join(folder, "intro.tex"), "");
    const [located] = await findProblems([{ severity: "error", message: "Oops", file: "intro.tex" }], { projectFolder: folder, workDir: folder, mainFile: path.join(folder, "main.tex") });
    expect(located?.file).toBe(path.join(folder, "intro.tex"));
  });

  it("puts a problem that names the project folder itself on the main file", async () => {
    const folder = await makeTempDir();
    const mainFile = path.join(folder, "main.tex");
    const [located] = await findProblems([{ severity: "error", message: "Oops", file: folder }], { projectFolder: folder, workDir: folder, mainFile });
    expect(located?.file).toBe(mainFile);
  });
});
