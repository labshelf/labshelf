/** Handles the new-folder and add-a-paper prompts (a), renaming a folder (r), and the import of what gets added. */
import type { ImportOutcome } from "@labshelf/core";
import { countImportOutcomes } from "@labshelf/core";

import { ALL, folderTitle } from "../screenModel.js";
import type { App } from "../app.js";
import { openPrompt } from "../input/index.js";
import { truncate } from "../../../screen/index.js";

// Where new papers and pasted items go: the hovered folder; All papers and search results mean the library root.
export function targetFolder(app: App): string {
  if (app.search !== undefined || app.folder === ALL) { return ""; }
  return app.folder;
}

export function promptAdd(app: App): void {
  if (app.focus === "folders") {
    const parent = app.folder === ALL ? "" : app.folder;
    openPrompt(app, "add", `New folder in ${parent ? folderTitle(parent) : "the library root"}`, "", "Folder name", [parent, "folder"]);
    return;
  }
  const target = targetFolder(app);
  openPrompt(app, "add", `Add a paper to ${target ? folderTitle(target) : "the library root"}`, "",
    "PDF or folder path (Tab completes), PDF URL, DOI or arXiv id — or name/ for a new folder", [target]);
}

export function promptRename(app: App): void {
  const folder = app.listModel.hoveredFolderRel();
  if (folder === undefined || folder === "") {
    app.taskStatus.notify(app.focus === "papers"
      ? "Paper titles stay as resolved (folders are named after them); r renames folders"
      : "Hover a folder to rename it", "warn");
    return;
  }
  openPrompt(app, "rename", "Rename folder", app.ctx.store.collection(folder)?.name ?? "", undefined, [folder]);
}

export async function importInputs(app: App, inputs: string[], target: string): Promise<void> {
  await app.taskStatus.task("import", "importing", async () => {
    const outcomes = await app.ctx.papers.importAny(inputs, target, (p) => {
      app.tasks.set("import", `importing ${p.index}/${p.total}`);
      app.scheduleRender();
    });
    reportImport(app, outcomes);
  });
}

function reportImport(app: App, outcomes: ImportOutcome[]): void {
  const shortened = outcomes.map((o): ImportOutcome => (o.status === "added" ? { ...o, record: { ...o.record, title: truncate(o.record.title, 60) } } : o));
  const summary = countImportOutcomes(shortened);
  if (summary.reveal) { app.historyNav.revealPaper(summary.reveal); }
  app.taskStatus.notify(summary.text, summary.level === "warn" ? "warn" : "info");
}
