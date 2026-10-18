/** Verifies the value files a project lists are read in order, with skipped files and keys logged. */
import { posixPathOps } from "../../../src/library/index";
import type { ProjectSettings } from "../../../src/writing/project/index";
import { readProjectValues } from "../../../src/writing/values/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

async function folderWith(files: Record<string, string>): Promise<MemoryLibraryFs> {
  const fs = new MemoryLibraryFs();
  for (const [name, text] of Object.entries(files)) { await fs.writeText(`/p/${name}`, text); }
  return fs;
}

describe("readProjectValues", () => {
  it("reads the listed files in order and logs a missing or invalid file with the project and path", async () => {
    const fs = await folderWith({ "results.json": '{"acc":0.9}', "bad.json": "{oops", "data/more.json": '{"n":2}' });
    const logger = fakeLogger();
    const leaves = await readProjectValues(
      { folder: "/p", settings: { id: "p", format: "latex", values: ["./results.json", "bad.json", "gone.json", "data\\more.json"] } },
      { fs, paths: posixPathOps, logger },
    );
    expect(leaves.map((leaf) => [leaf.key, leaf.file])).toEqual([["results.acc", "results.json"], ["more.n", "data/more.json"]]);
    expect(logger.logs.filter((entry) => entry.level === "WARN" && entry.message === "value file skipped")).toHaveLength(2);
  });

  it("logs the keys it skips", async () => {
    const fs = await folderWith({ "results.json": '{"a b":1,"c":2}' });
    const logger = fakeLogger();
    const leaves = await readProjectValues({ folder: "/p", settings: { id: "p", format: "latex", values: ["results.json"] } }, { fs, paths: posixPathOps, logger });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["results.c"]);
    expect(logger.logs.map((entry) => entry.message)).toEqual([expect.stringContaining("value keys skipped")]);
  });

  it("reads only the first of two files with the same name, so their keys cannot collide", async () => {
    const fs = await folderWith({ "results.json": '{"acc":1}', "old/results.json": '{"acc":2}' });
    const logger = fakeLogger();
    const settings: ProjectSettings = { id: "p", format: "latex", values: ["results.json", "old/results.json"] };
    const leaves = await readProjectValues({ folder: "/p", settings }, { fs, paths: posixPathOps, logger });
    expect(leaves.map((leaf) => [leaf.key, leaf.value])).toEqual([["results.acc", 1]]);
    expect(logger.logs.map((entry) => entry.message)).toEqual([expect.stringContaining("same name")]);
  });
});
