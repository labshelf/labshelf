/** Verifies PATH lookup finds executable files and skips plain ones. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { findExecutable } from "../../../../src/latex/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("findExecutable", () => {
  posixOnly("finds an executable in a PATH directory", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "latexmk");
    await fs.writeFile(file, "#!/bin/sh\n", { mode: 0o755 });
    expect(await findExecutable("latexmk", { PATH: `/nonexistent${path.delimiter}${dir}` })).toBe(file);
  });

  posixOnly("skips a file that is not executable", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "latexmk"), "text", { mode: 0o644 });
    expect(await findExecutable("latexmk", { PATH: dir })).toBeUndefined();
  });

  it("returns undefined when PATH is missing or the program is absent", async () => {
    const dir = await makeTempDir();
    expect(await findExecutable("latexmk", { PATH: dir })).toBeUndefined();
    expect(await findExecutable("latexmk", {})).toBeUndefined();
  });
});
