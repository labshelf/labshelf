import { promises as fs, utimesSync } from "node:fs";
import * as path from "node:path";

import { scanConflictCopies } from "../../../../src/library/conflicts/node/index";
import { serializePaperSidecar } from "../../../../src/reader/index";
import type { Annotation } from "../../../../src/model/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

function note(id: string): Annotation {
  return { id, paperId: "smith2020x", type: "note", pageNumber: 1, content: id, createdAt: "2024", updatedAt: "2024" };
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

describe("scanConflictCopies", () => {
  it("reports conflict copies inside paper folders, with the paper id", async () => {
    const root = await makeTempDir();
    const paper = path.join(root, "papers", "ml", "smith2020x");
    await write(path.join(paper, "metadata.yaml"), "title: x\n");
    await write(path.join(paper, "metadata (conflicted copy 2024-01-02 101010).yaml"), "title: y\n");
    await write(path.join(paper, "paper.sync-conflict-20240301-123456-ABCDEFG.pdf"), "pdf");
    await write(path.join(paper, "figs", "plot.conflict1.png"), "png");
    await write(path.join(paper, "paper (1).pdf"), "not a conflict");

    const copies = await scanConflictCopies(root, fakeLogger());
    const byCopy = Object.fromEntries(copies.map((c) => [path.relative(paper, c.copy), c]));
    expect(Object.keys(byCopy).sort()).toEqual([
      path.join("figs", "plot.conflict1.png"),
      "metadata (conflicted copy 2024-01-02 101010).yaml",
      "paper.sync-conflict-20240301-123456-ABCDEFG.pdf",
    ]);
    expect(byCopy["paper.sync-conflict-20240301-123456-ABCDEFG.pdf"]).toEqual({
      owner: { kind: "paper", id: "smith2020x" },
      original: path.join(paper, "paper.pdf"),
      copy: path.join(paper, "paper.sync-conflict-20240301-123456-ABCDEFG.pdf"),
      tool: "syncthing",
    });
    expect(byCopy[path.join("figs", "plot.conflict1.png")]?.original).toBe(path.join(paper, "figs", "plot.png"));
  });

  it("ignores conflict-named files outside paper folders and in hidden folders", async () => {
    const root = await makeTempDir();
    await write(path.join(root, "papers", "ml", "notes (conflicted copy 2024-01-02 101010).txt"), "x");
    await write(path.join(root, "papers", "ml", "a2020b", "metadata.yaml"), "title: x\n");
    await write(path.join(root, "papers", "ml", "a2020b", ".stversions", "paper.sync-conflict-20240301-123456-ABCDEFG.pdf"), "x");
    expect(await scanConflictCopies(root, fakeLogger())).toEqual([]);
  });

  it("merges a sidecar conflict copy into data.json and deletes the copy", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, ".research", "papers", "smith2020x");
    const mine = path.join(dir, "data.json");
    const copy = path.join(dir, "data.sync-conflict-20240301-123456-ABCDEFG.json");
    await write(mine, serializePaperSidecar({ annotations: [note("a")], theme: "auto" }));
    await write(copy, serializePaperSidecar({ annotations: [note("b")], theme: "dark" }));
    utimesSync(mine, 1000, 1000);
    utimesSync(copy, 2000, 2000);
    const logger = fakeLogger();

    expect(await scanConflictCopies(root, logger)).toEqual([]);
    expect(await listFiles(dir)).toEqual(["data.json"]);
    expect(await fs.readFile(mine, "utf8")).toBe(serializePaperSidecar({ annotations: [note("a"), note("b")], theme: "dark" }));
    expect(logger.logs.some((l) => l.level === "INFO" && /merged/i.test(l.message))).toBe(true);
  });

  it("merges every sidecar copy in turn and adopts a copy whose original is gone", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, ".research", "papers", "smith2020x");
    await write(path.join(dir, "data.json.conflict1"), serializePaperSidecar({ annotations: [note("a")], theme: "auto" }));
    await write(path.join(dir, "data.json.conflict2"), serializePaperSidecar({ annotations: [note("b")], theme: "auto" }));

    expect(await scanConflictCopies(root, fakeLogger())).toEqual([]);
    expect(await listFiles(dir)).toEqual(["data.json"]);
    const merged = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8")) as { annotations: Annotation[] };
    expect(merged.annotations.map((a) => a.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps a sidecar copy it cannot merge and reports it", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, ".research", "papers", "smith2020x");
    await write(path.join(dir, "data.json"), serializePaperSidecar({ annotations: [note("a")], theme: "auto" }));
    const copy = path.join(dir, "data (Bob's conflicted copy 2024-03-01).json");
    await write(copy, "{ broken");
    const logger = fakeLogger();

    expect(await scanConflictCopies(root, logger)).toEqual([
      { owner: { kind: "paper", id: "smith2020x" }, original: path.join(dir, "data.json"), copy, tool: "dropbox" },
    ]);
    expect(await fs.readFile(copy, "utf8")).toBe("{ broken");
    expect(logger.logs.some((l) => l.level === "WARN")).toBe(true);
  });

  it("returns nothing for a library without papers or sidecars", async () => {
    expect(await scanConflictCopies(await makeTempDir(), fakeLogger())).toEqual([]);
  });
});
