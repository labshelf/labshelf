import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ensurePrivateDir, isGroupOrOtherWritable } from "../../../src/library/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

const posix = process.platform === "win32" ? describe.skip : describe;

posix("ensurePrivateDir", () => {
  it("creates missing folders with mode 0o700", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, "a", "b");
    await ensurePrivateDir(dir);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("tightens an existing folder", async () => {
    const dir = await makeTempDir();
    await fs.chmod(dir, 0o775);
    await ensurePrivateDir(dir);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  });
});

describe("isGroupOrOtherWritable", () => {
  it("is true when the group or others can write", () => {
    expect(isGroupOrOtherWritable(0o775)).toBe(true);
    expect(isGroupOrOtherWritable(0o757)).toBe(true);
    expect(isGroupOrOtherWritable(0o700)).toBe(false);
    expect(isGroupOrOtherWritable(0o755)).toBe(false);
  });
});
