import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isDirectory, isFile } from "../../src/files/node/index";

describe("fsProbe", () => {
  let folder: string;
  let file: string;
  let missing: string;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "labshelf-probe-"));
    file = join(folder, "paper.txt");
    missing = join(folder, "missing");
    await writeFile(file, "x");
  });

  afterAll(() => rm(folder, { recursive: true, force: true }));

  it("tells a folder from a file", async () => {
    expect(await isDirectory(folder)).toBe(true);
    expect(await isFile(folder)).toBe(false);
    expect(await isFile(file)).toBe(true);
    expect(await isDirectory(file)).toBe(false);
  });

  it("answers false for a path that does not exist", async () => {
    expect(await isDirectory(missing)).toBe(false);
    expect(await isFile(missing)).toBe(false);
  });
});
