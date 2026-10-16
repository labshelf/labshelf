/** Verifies the on-disk project state: persistence, key preservation, corrupt-file protection and the newest edit across projects. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  latestProjectEdit, readProjectCursor, writeProjectCursor, type ProjectEntry,
} from "../../../../src/writing/project/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const cursor = { file: "main.tex", line: 3, character: 1, updatedAt: "2026-01-02T10:00:00.000Z" };
const stateFile = (folder: string) => path.join(folder, ".labshelf", "state.json");

function ready(folder: string, id: string): ProjectEntry {
  return { kind: "ready", folder, location: "library", settings: { id, format: "latex", engine: "tectonic" } as never, main: "main.tex" };
}

describe("project state file", () => {
  it("reads nothing from a project without a state file", async () => {
    const logger = fakeLogger();
    expect(await readProjectCursor(await makeTempDir(), logger)).toBeUndefined();
    expect(logger.logs).toEqual([]);
  });

  it("writes the cursor, reads it back and keeps keys it does not know", async () => {
    const folder = await makeTempDir();
    await fs.mkdir(path.join(folder, ".labshelf"));
    await fs.writeFile(stateFile(folder), '{"keep":true}');
    await writeProjectCursor(folder, cursor);
    expect(JSON.parse(await fs.readFile(stateFile(folder), "utf8"))).toEqual({ keep: true, ...cursor });
    expect(await readProjectCursor(folder, fakeLogger())).toEqual(cursor);
    expect((await fs.readdir(path.join(folder, ".labshelf")))).toEqual(["state.json"]);
  });

  it("never overwrites a state file that is not a JSON object", async () => {
    const folder = await makeTempDir();
    await fs.mkdir(path.join(folder, ".labshelf"));
    await fs.writeFile(stateFile(folder), "not json");
    await expect(writeProjectCursor(folder, cursor)).rejects.toThrow("corrupt");
    expect(await fs.readFile(stateFile(folder), "utf8")).toBe("not json");
    const logger = fakeLogger();
    expect(await readProjectCursor(folder, logger)).toBeUndefined();
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("finds the project edited last and ignores broken projects and invalid cursors", async () => {
    const [a, b, c] = [await makeTempDir(), await makeTempDir(), await makeTempDir()];
    await writeProjectCursor(a, cursor);
    await writeProjectCursor(b, { ...cursor, file: "sec/two.tex", updatedAt: "2026-01-03T10:00:00.000Z" });
    await fs.mkdir(path.join(c, ".labshelf"));
    await fs.writeFile(stateFile(c), '{"file":"../x","line":0,"character":0,"updatedAt":"2026-02-01T00:00:00.000Z"}');
    const entries = [ready(a, "alpha"), ready(b, "beta"), ready(c, "gamma"), { kind: "broken", folder: a, location: "library", reason: "x" } as ProjectEntry];
    const latest = await latestProjectEdit(entries, fakeLogger());
    expect(latest).toMatchObject({ id: "beta", folder: b, cursor: { file: "sec/two.tex" } });
    expect(await latestProjectEdit([], fakeLogger())).toBeUndefined();
  });
});
