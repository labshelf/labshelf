/** Verifies editing a project's checklist.json: creation, edits, keeping fields it does not patch, malformed files. */
import { addManualItem, manualItems, updateChecklist } from "@labshelf/core";

import { memoryCatalog, readText } from "../../support/memoryProjectCatalog";

const NOW = "2026-10-16T09:12:00.000Z";
const FOLDER = "/p";
const FILE = `${FOLDER}/.labshelf/checklist.json`;
const item = { id: "a", text: "Ask Ana", done: false, createdAt: NOW };

describe("updateChecklist", () => {
  it("creates the file and its folder on the first edit, passing an empty document", async () => {
    const context = memoryCatalog();
    let received: unknown;
    await updateChecklist(context, FOLDER, (doc) => {
      received = JSON.parse(JSON.stringify(doc));
      return addManualItem(doc, { id: "a", text: "Ask Ana", now: NOW });
    });
    expect(received).toEqual({ items: [] });
    expect(JSON.parse(readText(context.fs, FILE))).toEqual({ items: [item] });
    expect(await context.fs.listDir(`${FOLDER}/.labshelf`)).toEqual(["checklist.json"]);
    expect(manualItems(JSON.parse(readText(context.fs, FILE)))).toEqual([item]);
  });

  it("keeps unknown keys and invalid items on edit", async () => {
    const context = memoryCatalog();
    await context.fs.writeText(FILE, JSON.stringify({ keep: true, items: [{ id: "bad" }] }));
    await updateChecklist(context, FOLDER, (doc) => addManualItem(doc, { id: "a", text: "Ask Ana", now: NOW }));
    expect(JSON.parse(readText(context.fs, FILE))).toEqual({ keep: true, items: [{ id: "bad" }, item] });
  });

  it("passes the stored document to the edit and skips an unchanged write", async () => {
    const context = memoryCatalog();
    await context.fs.writeText(FILE, JSON.stringify({ items: [item] }, null, 2) + "\n");
    const writes = context.fs.writes;
    let seen: string[] = [];
    await updateChecklist(context, FOLDER, (doc) => { seen = manualItems(doc).map((entry) => entry.id); return doc; });
    expect(seen).toEqual(["a"]);
    expect(context.fs.writes).toBe(writes);
  });

  it("never overwrites a malformed file, fails the edit and logs it with the path", async () => {
    const context = memoryCatalog();
    await context.fs.writeText(FILE, '{"items": 3}');
    await expect(updateChecklist(context, FOLDER, (doc) => addManualItem(doc, { id: "a", text: "t", now: NOW }))).rejects.toThrow(FILE);
    expect(readText(context.fs, FILE)).toBe('{"items": 3}');
    expect(context.logger.errors).toEqual([{ module: "writing/checklist", context: { file: FILE } }]);
  });
});
