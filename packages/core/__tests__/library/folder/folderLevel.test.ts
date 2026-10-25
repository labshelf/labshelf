import { posixPathOps } from "@labshelf/core";
import { readFolderLevel } from "../../../src/library/folder/folderLevel";
import { createScanEnv } from "../../../src/library/folder/scanEnv";

import { makeHarness, PAPERS } from "../../support/mutationHarness";

describe("readFolderLevel", () => {
  it("splits one directory into collections (by name, numerically), papers and orphans", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${PAPERS}/Set 10`);
    await h.fs.mkdir(`${PAPERS}/set 2`);
    await h.seedPaper(`${PAPERS}/paper`, { title: "P" });
    await h.fs.writeText(`${PAPERS}/orphan/paper.pdf`, "x");
    await h.fs.writeText(`${PAPERS}/readme.md`, "not a folder");
    const level = await readFolderLevel(createScanEnv(h.fs, posixPathOps, h.ctx.logger), PAPERS);
    expect(level.collections).toEqual([`${PAPERS}/set 2`, `${PAPERS}/Set 10`]);
    expect(level.papers.map((p) => [p.path, p.pdf !== undefined])).toEqual([[`${PAPERS}/paper`, true]]);
    expect(level.orphans).toEqual([`${PAPERS}/orphan`]);
  });

  it("does not descend: a collection's papers are not in the parent's level", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/ML/deep`, { title: "D" });
    const level = await readFolderLevel(createScanEnv(h.fs, posixPathOps, h.ctx.logger), PAPERS);
    expect(level.papers).toEqual([]);
    expect(level.collections).toEqual([`${PAPERS}/ML`]);
  });
});
