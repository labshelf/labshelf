/** Submits each overlay prompt purpose on Enter: add, tags, tagsBatch, rename, export and command. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PromptOverlay } from "../../overlays.js";
import { importInputs, targetFolder } from "../actions/index.js";
import { targetsForExport } from "../actions/index.js";
import { runCommand } from "../actions/index.js";
import type { App } from "../app.js";
import { looksLikePath } from "./promptCompletion.js";

export function submitPrompt(app: App, prompt: PromptOverlay): void {
  const value = prompt.input.value.trim();
  switch (prompt.purpose) {
    case "add": return submitAdd(app, prompt, value);
    case "tags": return submitTags(app, prompt, value);
    case "tagsBatch": return submitTagsBatch(app, prompt, value);
    case "rename": return submitRename(app, prompt, value);
    case "export": return submitExport(app, value);
    case "command": return submitCommand(app, value);
  }
}

function submitAdd(app: App, prompt: PromptOverlay, value: string): void {
  if (!value) { return; }
  const parent = prompt.targets[0] ?? targetFolder(app);
  // yazi's convention: a single name ending in "/" creates a folder; anything else is a path, URL or identifier.
  const folderOnly = prompt.targets[1] === "folder";
  if (folderOnly || (/^[^/]+\/$/.test(value) && !looksLikePath(value))) {
    const name = value.replace(/\/+$/, "");
    void app.taskStatus.task("folder", "creating folder", async () => {
      app.folder = await app.ctx.papers.createCollection(parent, name);
      app.focus = "folders";
      app.taskStatus.notify(`Folder "${name}" created`);
    });
    return;
  }
  void importInputs(app, [value], parent);
}

function submitTags(app: App, prompt: PromptOverlay, value: string): void {
  const id = prompt.targets[0];
  if (!id) { return; }
  const tags = value.split(",").map((t) => t.trim()).filter(Boolean);
  void app.taskStatus.task("tags", "saving tags", async () => {
    await app.ctx.papers.updateFields(id, { tags });
    app.taskStatus.notify(tags.length ? `Tags: ${tags.join(", ")}` : "Tags cleared");
  });
}

function submitTagsBatch(app: App, prompt: PromptOverlay, value: string): void {
  const add: string[] = [];
  const remove: string[] = [];
  for (const token of value.split(/\s+/).filter((t) => t && t !== "+" && t !== "-")) {
    if (token.startsWith("-")) { remove.push(token.slice(1)); } else { add.push(token.replace(/^\+/, "")); }
  }
  if (!add.length && !remove.length) { return; }
  void app.taskStatus.task("tags", "saving tags", async () => {
    const outcome = await app.ctx.papers.editTags(prompt.targets, add, remove);
    app.taskStatus.notifyBatch(outcome.done.length, outcome.failed, "updated");
    app.selection.clear();
  });
}

function submitRename(app: App, prompt: PromptOverlay, value: string): void {
  const rel = prompt.targets[0];
  if (rel === undefined || !value) { return; }
  void app.taskStatus.task("rename", "renaming", async () => {
    app.folder = await app.ctx.papers.renameCollection(rel, value);
    app.taskStatus.notify(`Renamed to "${value}"`);
  });
}

function submitExport(app: App, value: string): void {
  if (!value) { return; }
  const records = targetsForExport(app);
  void app.taskStatus.task("export", "exporting", async () => {
    const file = path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()));
    await fs.writeFile(file, app.ctx.papers.bibtexFor(records));
    app.taskStatus.notify(`${records.length} BibTeX entries written to ${file}`);
  });
}

function submitCommand(app: App, value: string): void {
  runCommand(app, value);
}
