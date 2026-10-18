/** Verifies the hand-added checklist items read through the file-system port: missing, valid and malformed files. */
import { posixPathOps } from "../../../src/library/index";
import { readManualItems } from "../../../src/writing/checklist/index";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const NOW = "2026-10-16T09:12:00.000Z";
const FILE = "/p/.labshelf/checklist.json";
const item = { id: "a", text: "Ask Ana", done: false, createdAt: NOW };

describe("readManualItems", () => {
  it("reads no items from a project without a checklist file", async () => {
    const logger = fakeLogger();
    expect(await readManualItems({ fs: new MemoryLibraryFs(), paths: posixPathOps, logger }, "/p")).toEqual([]);
    expect(logger.logs).toEqual([]);
  });

  it("reads the valid items of an existing file", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText(FILE, JSON.stringify({ items: [item, { id: "bad" }] }));
    expect(await readManualItems({ fs, paths: posixPathOps, logger: fakeLogger() }, "/p")).toEqual([item]);
  });

  it("reads a malformed file as no items and logs a warning", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText(FILE, "not json");
    const logger = fakeLogger();
    expect(await readManualItems({ fs, paths: posixPathOps, logger }, "/p")).toEqual([]);
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("reads an unreadable file as no items and logs the error", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText(FILE, "{}");
    fs.readText = async () => { throw new Error("EIO"); };
    const logger = fakeLogger();
    expect(await readManualItems({ fs, paths: posixPathOps, logger }, "/p")).toEqual([]);
    expect(logger.errors).toHaveLength(1);
  });
});
