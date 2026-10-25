/** Verifies that sidecar conflict copies merge into data.json without losing an edit made on any device. */
import * as nodeFs from "node:fs";
import * as path from "node:path";

import { scanConflictCopies } from "../../../../src/library/conflicts/node/index";
import * as atomicWrite from "../../../../src/library/node/atomicWrite";
import { serializePaperSidecar, type PaperSidecar } from "../../../../src/reader/index";
import type { Annotation } from "../../../../src/model/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";

const fs = nodeFs.promises;

afterEach(async () => {
  jest.restoreAllMocks();
  await cleanupTempDirs();
});

function note(id: string, content = id): Annotation {
  return { id, paperId: "smith2020x", type: "note", pageNumber: 1, content, createdAt: `2024-${id}`, updatedAt: "2024" };
}

async function sidecarDir(): Promise<{ root: string; dir: string; dataJson: string }> {
  const root = await makeTempDir();
  const dir = path.join(root, ".research", "papers", "smith2020x");
  await fs.mkdir(dir, { recursive: true });
  return { root, dir, dataJson: path.join(dir, "data.json") };
}

async function write(file: string, data: PaperSidecar, mtimeSeconds?: number): Promise<void> {
  await fs.writeFile(file, serializePaperSidecar(data));
  if (mtimeSeconds !== undefined) { nodeFs.utimesSync(file, mtimeSeconds, mtimeSeconds); }
}

async function read(file: string): Promise<PaperSidecar> {
  return JSON.parse(await fs.readFile(file, "utf8")) as PaperSidecar;
}

/** Makes every read of a conflict copy first change data.json, as a sync tool or the reader would. */
function editDataJsonWhileReadingCopies(dataJson: string, times: number): void {
  const realReadFile = fs.readFile.bind(fs);
  let edits = 0;
  jest.spyOn(fs, "readFile").mockImplementation((async (file: nodeFs.PathLike, options?: unknown) => {
    if (String(file).includes("conflict") && edits < times) {
      edits++;
      const current = JSON.parse(await realReadFile(dataJson, "utf8")) as PaperSidecar;
      await fs.writeFile(dataJson, serializePaperSidecar({ ...current, annotations: [...current.annotations, note(`c${edits}`)] }));
    }
    return realReadFile(file, options as BufferEncoding);
  }) as typeof fs.readFile);
}

describe("sidecar conflict merge", () => {
  it("lets the newest edit win when several copies change the same annotation and theme", async () => {
    const { root, dir, dataJson } = await sidecarDir();
    await write(dataJson, { annotations: [note("a", "base")], theme: "auto" }, 1000);
    await write(path.join(dir, "data.json.conflict1"), { annotations: [note("a", "older")], theme: "dark" }, 2000);
    await write(path.join(dir, "data.json.conflict2"), { annotations: [note("a", "newest")], theme: "sepia" }, 3000);

    expect(await scanConflictCopies(root, fakeLogger())).toEqual([]);
    expect(await listFiles(dir)).toEqual(["data.json"]);
    const merged = await read(dataJson);
    expect(merged.annotations.map((a) => a.content)).toEqual(["newest"]);
    expect(merged.theme).toBe("sepia");
  });

  it("redoes the merge when data.json changes while it is merged", async () => {
    const { root, dir, dataJson } = await sidecarDir();
    await write(dataJson, { annotations: [note("a")], theme: "auto" }, 1000);
    await write(path.join(dir, "data.json.conflict1"), { annotations: [note("b")], theme: "auto" }, 2000);
    editDataJsonWhileReadingCopies(dataJson, 1);

    expect(await scanConflictCopies(root, fakeLogger())).toEqual([]);
    expect((await read(dataJson)).annotations.map((a) => a.id).sort()).toEqual(["a", "b", "c1"]);
    expect(await listFiles(dir)).toEqual(["data.json"]);
  });

  it("keeps the copy and reports it when data.json keeps changing", async () => {
    const { root, dir, dataJson } = await sidecarDir();
    await write(dataJson, { annotations: [note("a")], theme: "auto" }, 1000);
    const copy = path.join(dir, "data.json.conflict1");
    await write(copy, { annotations: [note("b")], theme: "auto" }, 2000);
    editDataJsonWhileReadingCopies(dataJson, 100);
    const logger = fakeLogger();

    expect((await scanConflictCopies(root, logger)).map((c) => c.copy)).toEqual([copy]);
    expect((await read(copy)).annotations.map((a) => a.id)).toEqual(["b"]);
    expect(logger.logs.some((l) => l.level === "WARN")).toBe(true);
  });

  it("keeps the copy when data.json does not hold the merged bytes after the write", async () => {
    const { root, dir, dataJson } = await sidecarDir();
    await write(dataJson, { annotations: [note("a")], theme: "auto" }, 1000);
    const copy = path.join(dir, "data.json.conflict1");
    await write(copy, { annotations: [note("b")], theme: "auto" }, 2000);
    jest.spyOn(atomicWrite, "writeFileAtomic").mockResolvedValue(undefined);

    expect((await scanConflictCopies(root, fakeLogger())).map((c) => c.copy)).toEqual([copy]);
    expect(await listFiles(dir)).toEqual(["data.json", "data.json.conflict1"]);
  });

  it("keeps a copy that is not a sidecar instead of adopting it when data.json is missing", async () => {
    const { root, dir } = await sidecarDir();
    const copy = path.join(dir, "data.json.conflict1");
    await fs.writeFile(copy, "{ broken");

    expect((await scanConflictCopies(root, fakeLogger())).map((c) => c.copy)).toEqual([copy]);
    expect(await listFiles(dir)).toEqual(["data.json.conflict1"]);
  });
});
