import { promises as fs } from "node:fs";
import * as path from "node:path";

import { assertPrivatePaths } from "../../../../src/helper/node/privacyCheck/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const posix = process.platform === "win32" ? describe.skip : describe;

async function layout(dirMode: number, binaryMode: number) {
  const root = await makeTempDir();
  const dataDir = path.join(root, "data");
  const binaryPath = path.join(root, "labshelf-helper");
  await fs.mkdir(dataDir);
  await fs.writeFile(binaryPath, "binary");
  await fs.chmod(dataDir, dirMode);
  await fs.chmod(binaryPath, binaryMode);
  return { dataDir, binaryPath };
}

posix("assertPrivatePaths", () => {
  it("accepts a 0o700 data folder and a 0o755 binary", async () => {
    const { dataDir, binaryPath } = await layout(0o700, 0o755);
    await expect(assertPrivatePaths([dataDir, binaryPath])).resolves.toBeUndefined();
  });

  it("refuses a 0o775 data folder and names its path and mode", async () => {
    const { dataDir, binaryPath } = await layout(0o775, 0o755);
    await expect(assertPrivatePaths([dataDir, binaryPath])).rejects.toThrow(`${dataDir} (mode 775)`);
  });

  it("leaves the mode of the folder it refuses unchanged", async () => {
    const { dataDir, binaryPath } = await layout(0o775, 0o755);
    await assertPrivatePaths([dataDir, binaryPath]).catch(() => undefined);
    expect((await fs.stat(dataDir)).mode & 0o777).toBe(0o775);
  });

  it("refuses a 0o777 binary", async () => {
    const { dataDir, binaryPath } = await layout(0o700, 0o777);
    await expect(assertPrivatePaths([dataDir, binaryPath])).rejects.toThrow(binaryPath);
  });

  it("skips a path that does not exist yet", async () => {
    const { binaryPath } = await layout(0o700, 0o755);
    await expect(assertPrivatePaths([path.join(path.dirname(binaryPath), "absent"), binaryPath])).resolves.toBeUndefined();
  });
});
