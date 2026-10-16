/** Verifies the on-disk checklist: missing and malformed files, creation, edits, key preservation. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { addManualItem, manualItems } from "../../../../src/writing/checklist/index";
import { readManualItems, updateChecklist } from "../../../../src/writing/checklist/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const NOW = "2026-10-16T09:12:00.000Z";
const checklistFile = (folder: string) => path.join(folder, ".labshelf", "checklist.json");
const item = { id: "a", text: "Ask Ana", done: false, createdAt: NOW };

async function writeRaw(folder: string, text: string): Promise<void> {
  await fs.mkdir(path.join(folder, ".labshelf"), { recursive: true });
  await fs.writeFile(checklistFile(folder), text);
}

describe("checklist store", () => {
  it("reads no items from a project without a checklist file", async () => {
    const logger = fakeLogger();
    expect(await readManualItems(await makeTempDir(), logger)).toEqual([]);
    expect(logger.logs).toEqual([]);
  });

  it("reads the valid items of an existing file", async () => {
    const folder = await makeTempDir();
    await writeRaw(folder, JSON.stringify({ items: [item, { id: "bad" }] }));
    expect(await readManualItems(folder, fakeLogger())).toEqual([item]);
  });

  it("reads a malformed file as no items and logs a warning", async () => {
    const folder = await makeTempDir();
    await writeRaw(folder, "not json");
    const logger = fakeLogger();
    expect(await readManualItems(folder, logger)).toEqual([]);
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("creates the file and its folder on the first edit, passing an empty document", async () => {
    const folder = await makeTempDir();
    let received: unknown;
    await updateChecklist(folder, (doc) => {
      received = JSON.parse(JSON.stringify(doc));
      return addManualItem(doc, { id: "a", text: "Ask Ana", now: NOW });
    });
    expect(received).toEqual({ items: [] });
    expect(JSON.parse(await fs.readFile(checklistFile(folder), "utf8"))).toEqual({ items: [item] });
    expect(await fs.readdir(path.join(folder, ".labshelf"))).toEqual(["checklist.json"]);
    expect(await readManualItems(folder, fakeLogger())).toEqual([item]);
  });

  it("keeps unknown keys and invalid items on edit", async () => {
    const folder = await makeTempDir();
    await writeRaw(folder, JSON.stringify({ keep: true, items: [{ id: "bad" }] }));
    await updateChecklist(folder, (doc) => addManualItem(doc, { id: "a", text: "Ask Ana", now: NOW }));
    expect(JSON.parse(await fs.readFile(checklistFile(folder), "utf8"))).toEqual({ keep: true, items: [{ id: "bad" }, item] });
  });

  it("passes the stored document to the edit", async () => {
    const folder = await makeTempDir();
    await writeRaw(folder, JSON.stringify({ items: [item] }));
    let seen: string[] = [];
    await updateChecklist(folder, (doc) => { seen = manualItems(doc).map((entry) => entry.id); return doc; });
    expect(seen).toEqual(["a"]);
  });

  it("never overwrites a malformed file and fails the edit", async () => {
    const folder = await makeTempDir();
    await writeRaw(folder, '{"items": 3}');
    await expect(updateChecklist(folder, (doc) => addManualItem(doc, { id: "a", text: "t", now: NOW }))).rejects.toThrow();
    expect(await fs.readFile(checklistFile(folder), "utf8")).toBe('{"items": 3}');
  });
});
