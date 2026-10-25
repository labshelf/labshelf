// Tests recording, reading and restoring a project's history on the real disk through the Node storage.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readHistory, writeSnapshot, applySnapshot } from "../../../../src/writing/history/index";
import { createNodeHistoryProject } from "../../../../src/writing/history/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function setup() {
  const folder = await makeTempDir();
  const target = createNodeHistoryProject(folder, await makeTempDir());
  await write(path.join(folder, "main.tex"), "one");
  await write(path.join(folder, "main.pdf"), "%PDF built");
  await write(path.join(folder, ".labshelf", "state.json"), "{}");
  return { folder, target, logger: fakeLogger() };
}

describe("writeSnapshot", () => {
  it("records the sources without the built PDF or hidden folders, and skips an unchanged edit", async () => {
    const { target, logger } = await setup();
    const first = await writeSnapshot(target, "edit", logger);
    expect(Object.keys(first!.files)).toEqual(["main.tex"]);
    expect(await writeSnapshot(target, "edit", logger)).toBeUndefined();
    expect(await writeSnapshot(target, "version", logger, "submitted")).toMatchObject({ kind: "version", label: "submitted" });
    expect((await readHistory(target.storage, logger)).map((entry) => entry.kind)).toEqual(["edit", "version"]);
  });

  it("serializes concurrent saves so each change is recorded once", async () => {
    const { folder, target, logger } = await setup();
    await write(path.join(folder, "main.tex"), "two");
    await Promise.all([writeSnapshot(target, "edit", logger), writeSnapshot(target, "edit", logger)]);
    expect(await readHistory(target.storage, logger)).toHaveLength(1);
  });
});

describe("applySnapshot", () => {
  it("brings back an earlier entry's files, deletes later files and keeps the state it replaced", async () => {
    const { folder, target, logger } = await setup();
    const start = (await writeSnapshot(target, "edit", logger))!;
    await write(path.join(folder, "main.tex"), "two");
    await write(path.join(folder, "sections", "new.tex"), "added");
    const restored = await applySnapshot(target, start.id, logger);
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8")).toBe("one");
    await expect(fs.access(path.join(folder, "sections", "new.tex"))).rejects.toThrow();
    expect(await fs.readFile(path.join(folder, "main.pdf"), "utf8")).toBe("%PDF built");
    const entries = await readHistory(target.storage, logger);
    expect(entries.map((entry) => entry.kind)).toEqual(["edit", "edit", "restore"]);
    expect(restored.label).toBe(start.at);
    // The replaced state can itself be restored, so nothing is lost.
    await applySnapshot(target, entries[1]!.id, logger);
    expect(await fs.readFile(path.join(folder, "sections", "new.tex"), "utf8")).toBe("added");
  });

  it("throws on an unknown entry without touching the project", async () => {
    const { folder, target, logger } = await setup();
    await expect(applySnapshot(target, "missing", logger)).rejects.toThrow(/no entry missing/);
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8")).toBe("one");
  });
});
