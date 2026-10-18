import { promises as fs } from "node:fs";
import * as path from "node:path";

import { assertHelperPrivatePaths } from "../../../../../src/writing/helper/node/privacy/index";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(() => { jest.restoreAllMocks(); return cleanupTempDirs(); });

const posix = process.platform === "win32" ? describe.skip : describe;

async function layout(binDirMode: number) {
  const root = await makeTempDir();
  const dataDir = path.join(root, "data");
  const binaryDir = path.join(root, "bin");
  const binaryPath = path.join(binaryDir, "labshelf-helper");
  await fs.mkdir(dataDir);
  await fs.mkdir(binaryDir);
  await fs.writeFile(binaryPath, "binary");
  await fs.chmod(dataDir, 0o700);
  await fs.chmod(binaryDir, binDirMode);
  return { dataDir, binaryDir, binaryPath };
}

posix("assertHelperPrivatePaths", () => {
  it("accepts a private layout", async () => {
    const { dataDir, binaryPath } = await layout(0o755);
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).resolves.toBeUndefined();
  });

  it("refuses a binary folder that other users can write to", async () => {
    const { dataDir, binaryPath, binaryDir } = await layout(0o775);
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).rejects.toThrow(`${binaryDir} (mode 775)`);
  });

  it("accepts a group-writable binary folder owned by root", async () => {
    const { dataDir, binaryPath, binaryDir } = await layout(0o775);
    const stat = fs.stat.bind(fs);
    jest.spyOn(fs, "stat").mockImplementation(async (target, ...rest) => {
      const real = await (stat as (...args: unknown[]) => Promise<import("node:fs").Stats>)(target, ...rest);
      return target === binaryDir ? Object.assign(Object.create(real), { uid: 0, mode: real.mode }) : real;
    });
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).resolves.toBeUndefined();
  });

  it("refuses a bin folder inside the data folder that other users can write to", async () => {
    const { dataDir, binaryPath } = await layout(0o755);
    const bin = path.join(dataDir, "bin");
    await fs.mkdir(bin);
    await fs.chmod(bin, 0o777);
    await expect(assertHelperPrivatePaths({ binaryPath, dataDir })).rejects.toThrow(`${bin} (mode 777)`);
  });
});
