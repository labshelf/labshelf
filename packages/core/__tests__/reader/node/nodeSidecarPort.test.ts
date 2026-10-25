// Tests the Node.js sidecar port for reading and writing paper data.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createLibraryLayout } from "../../../src/library/index";
import { createNodeSidecarPort } from "../../../src/reader/node/index";
import { PaperDataStore, normalizePaperData, serializePaperData } from "../../../src/reader/index";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

async function setup() {
  const root = await makeTempDir();
  const layout = createLibraryLayout(root, path.join);
  return { root, layout };
}

describe("createNodeSidecarPort", () => {
  it("reads null for a paper without a sidecar", async () => {
    const { layout } = await setup();
    expect(await createNodeSidecarPort(layout).read("nope")).toBeNull();
  });

  it("writes to .research/papers/<id>/data.json, creating the folder, and reads it back", async () => {
    const { root, layout } = await setup();
    const port = createNodeSidecarPort(layout);
    await port.write("new-paper", '{"annotations":[],"theme":"auto"}');
    expect(await fs.readFile(path.join(root, ".research", "papers", "new-paper", "data.json"), "utf8")).toBe('{"annotations":[],"theme":"auto"}');
    expect(await port.read("new-paper")).toBe('{"annotations":[],"theme":"auto"}');
  });

  it("overwrites atomically: no temp file is left in the sidecar folder or the temp folder", async () => {
    const { layout } = await setup();
    const port = createNodeSidecarPort(layout);
    await port.write("p1", "first");
    await port.write("p1", "second");
    expect(await port.read("p1")).toBe("second");
    expect(await listFiles(layout.paperDataRoot())).toEqual(["p1/data.json"]);
    expect(await listFiles(layout.tmpDir())).toEqual([]);
  });

  it("does not log a missing file", async () => {
    const { layout } = await setup();
    const log = jest.fn(async () => undefined);
    await createNodeSidecarPort(layout, { log, error: jest.fn(async () => undefined) }).read("nope");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a warning and reads null when the file cannot be read for another reason", async () => {
    const { layout } = await setup();
    // A directory where the file should be makes readFile fail with EISDIR.
    await fs.mkdir(layout.paperDataPath("broken"), { recursive: true });
    const log = jest.fn(async () => undefined);
    const port = createNodeSidecarPort(layout, { log, error: jest.fn(async () => undefined) });
    expect(await port.read("broken")).toBeNull();
    expect(log).toHaveBeenCalledWith("WARN", "sidecar", expect.any(String), expect.objectContaining({ paperId: "broken" }));
  });

  it("produces the bytes the shared store writes: fixed key order, two-space indent", async () => {
    const { layout } = await setup();
    const store = new PaperDataStore(createNodeSidecarPort(layout));
    const highlight = await store.addHighlight("p1", 3, "a sentence", "green", { x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
    await store.setTheme("p1", "dark");
    await store.setReadingState("p1", { page: 3, scaleValue: "page-width", updatedAt: "2025-01-01T00:00:00.000Z" });
    const raw = await fs.readFile(layout.paperDataPath("p1"), "utf8");
    const normalized = normalizePaperData(JSON.parse(raw) as unknown);
    expect(normalized.annotations).toEqual([highlight]);
    expect(raw).toBe(serializePaperData(normalized));
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(["annotations", "theme", "reading"]);
  });
});
