import { promises as fs } from "node:fs";
import * as path from "node:path";

import { detectLibraryFolder } from "../../../../src/library/node/location";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function makeLibrary(root: string, paperFolders: string[], orphans: string[] = []): Promise<void> {
  await fs.mkdir(path.join(root, ".research"), { recursive: true });
  for (const folder of paperFolders) {
    await fs.mkdir(path.join(root, "papers", folder), { recursive: true });
    await fs.writeFile(path.join(root, "papers", folder, "metadata.yaml"), "title: x\n");
  }
  for (const folder of orphans) {
    await fs.mkdir(path.join(root, "papers", folder), { recursive: true });
    await fs.writeFile(path.join(root, "papers", folder, "paper.pdf"), "pdf");
  }
  await fs.mkdir(path.join(root, "papers"), { recursive: true });
}

describe("inspectLibraryFolder", () => {
  it("reports a missing folder without an error", async () => {
    const root = path.join(await makeTempDir(), "nope");
    expect(await detectLibraryFolder(root)).toEqual({ exists: false, isLibrary: false, paperCount: 0 });
  });

  it("reports an empty folder as not a library", async () => {
    const root = await makeTempDir();
    expect(await detectLibraryFolder(root)).toEqual({ exists: true, isLibrary: false, paperCount: 0 });
  });

  it("reports a folder with only one marker dir as not a library", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, "papers"));
    expect((await detectLibraryFolder(root)).isLibrary).toBe(false);
  });

  it("counts papers, including those inside collections, and skips orphans", async () => {
    const root = await makeTempDir();
    await makeLibrary(root, ["a-1", "b-2", "Reviews/c-3"], ["orphan"]);
    expect(await detectLibraryFolder(root)).toEqual({ exists: true, isLibrary: true, paperCount: 3 });
  });

  it("reports a library with no papers", async () => {
    const root = await makeTempDir();
    await makeLibrary(root, []);
    expect(await detectLibraryFolder(root)).toEqual({ exists: true, isLibrary: true, paperCount: 0 });
  });

  it("reports a file in place of the folder as missing", async () => {
    const root = await makeTempDir();
    const file = path.join(root, "f");
    await fs.writeFile(file, "x");
    expect((await detectLibraryFolder(file)).exists).toBe(false);
  });
});
