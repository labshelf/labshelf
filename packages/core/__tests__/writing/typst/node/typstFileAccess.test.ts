/** Verifies compiler path mapping and the synchronous file access the compiler uses. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { fromCompilerPath, nodeTypstFiles, toCompilerPath } from "../../../../src/writing/typst/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("Typst file access", () => {
  it("round-trips an absolute path through the compiler path", () => {
    expect(toCompilerPath("/a/b/main.typ")).toBe("/a/b/main.typ");
    expect(fromCompilerPath(toCompilerPath("/a/b/main.typ"))).toBe("/a/b/main.typ");
  });

  it("maps a Windows drive path to a leading-slash compiler path and back", () => {
    expect(fromCompilerPath("/C:/proj/main.typ").startsWith("C:")).toBe(true);
  });

  it("reads, stats and reports a file", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "a.typ");
    await fs.writeFile(file, "hi");
    expect(Buffer.from(nodeTypstFiles.readAll(toCompilerPath(file))!).toString()).toBe("hi");
    expect(nodeTypstFiles.isFile(toCompilerPath(file))).toBe(true);
    expect(nodeTypstFiles.isFile(toCompilerPath(dir))).toBe(false);
    expect(nodeTypstFiles.getMTime(toCompilerPath(file))?.getTime()).toBeGreaterThan(0);
    expect(nodeTypstFiles.getRealPath(toCompilerPath(file))).toBe(toCompilerPath(file));
  });

  it("returns undefined for a missing file", async () => {
    const missing = toCompilerPath(path.join(await makeTempDir(), "nope.typ"));
    expect(nodeTypstFiles.readAll(missing)).toBeUndefined();
    expect(nodeTypstFiles.isFile(missing)).toBeUndefined();
    expect(nodeTypstFiles.getMTime(missing)).toBeUndefined();
  });
});
