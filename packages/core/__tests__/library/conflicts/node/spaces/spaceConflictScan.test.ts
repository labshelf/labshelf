import { promises as fs } from "node:fs";
import * as path from "node:path";

import { scanSpaceConflicts } from "../../../../../src/library/conflicts/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function write(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "{}");
}

describe("scanSpaceConflicts", () => {
  it("finds Syncthing and Dropbox copies of space.json with the Space id", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, "spaces", "s1");
    await write(path.join(dir, "space.json"));
    await write(path.join(dir, "space.sync-conflict-20240301-123456-ABCDEFG.json"));
    await write(path.join(dir, "space (Ana's conflicted copy 2024-03-01).json"));

    const copies = await scanSpaceConflicts(root, fakeLogger());
    expect(copies.map((c) => [c.owner, c.tool, c.original]).sort()).toEqual([
      [{ kind: "space", id: "s1" }, "dropbox", path.join(dir, "space.json")],
      [{ kind: "space", id: "s1" }, "syncthing", path.join(dir, "space.json")],
    ]);
  });

  it("finds a copy of glossary.json", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, "spaces", "s2");
    await write(path.join(dir, "glossary.sync-conflict-20240301-123456-ABCDEFG.json"));

    const copies = await scanSpaceConflicts(root, fakeLogger());
    expect(copies).toEqual([{
      owner: { kind: "space", id: "s2" },
      original: path.join(dir, "glossary.json"),
      copy: path.join(dir, "glossary.sync-conflict-20240301-123456-ABCDEFG.json"),
      tool: "syncthing",
    }]);
  });

  it("ignores nested copies, other files and hidden names", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, "spaces", "s3");
    await write(path.join(dir, "notes", "space.sync-conflict-20240301-123456-ABCDEFG.json"));
    await write(path.join(dir, "other.sync-conflict-20240301-123456-ABCDEFG.json"));
    await write(path.join(dir, ".space.sync-conflict-20240301-123456-ABCDEFG.json"));
    await write(path.join(root, "spaces", ".hidden", "space.sync-conflict-20240301-123456-ABCDEFG.json"));

    expect(await scanSpaceConflicts(root, fakeLogger())).toEqual([]);
  });

  it("returns an empty list when spaces/ is missing", async () => {
    expect(await scanSpaceConflicts(await makeTempDir(), fakeLogger())).toEqual([]);
  });
});
