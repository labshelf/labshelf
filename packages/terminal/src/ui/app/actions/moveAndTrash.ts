/** Cuts and pastes papers (x, p), moves them to a picked folder (M), and the trash confirmation (d). */
import { errorMessage, removeNotice } from "@labshelf/core";
import { trashSupported } from "../../../platform/index.js";
import { truncate } from "../../../tui/index.js";
import { ALL, folderTitle, parentFolder } from "../types.js";
import type { App } from "../app.js";
import { needPapers } from "./paperFieldActions.js";
import { openFolderPicker } from "../input/index.js";

export function cutTargets(app: App): void {
  const folder = app.listModel.hoveredFolderRel();
  if (folder !== undefined && !app.selection.size) {
    if (folder === "") { app.taskStatus.notify("The library root cannot be moved", "warn"); return; }
    app.cut = [`c:${folder}`];
    app.taskStatus.notify(`Folder "${folderTitle(folder)}" cut — hover the destination folder and press p`);
    return;
  }
  const papers = needPapers(app);
  if (!papers.length) { return; }
  app.cut = papers.map((p) => `p:${p.record.id}`);
  app.selection.clear();
  app.taskStatus.notify(`${papers.length} paper${papers.length === 1 ? "" : "s"} cut — go to a folder and press p`);
}

export function paste(app: App): void {
  if (!app.cut?.length) { app.taskStatus.notify("Nothing to paste — cut papers or a folder with x first", "warn"); return; }
  if (app.search !== undefined || app.folder === ALL) {
    app.taskStatus.notify("Choose a folder to paste into (in All papers, use M to pick one)", "warn");
    return;
  }
  const target = app.folder;
  const keys = app.cut;
  app.cut = undefined;
  void app.taskStatus.task("move", "moving", () => moveKeys(app, keys, target));
}

async function moveKeys(app: App, keys: string[], target: string): Promise<void> {
  const paperIds = keys.filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
  const folders = keys.filter((k) => k.startsWith("c:")).map((k) => k.slice(2));
  let moved = 0;
  const failed: Array<{ id: string; error: string }> = [];
  if (paperIds.length) {
    const outcome = await app.ctx.papers.movePapers(paperIds, target);
    moved += outcome.done.length;
    failed.push(...outcome.failed);
  }
  for (const rel of folders) {
    try {
      app.folder = await app.ctx.papers.moveCollection(rel, target);
      moved++;
    } catch (error) {
      failed.push({ id: rel, error: errorMessage(error) });
    }
  }
  app.taskStatus.notifyBatch(moved, failed, `moved to ${folderTitle(target)}`);
}

export function moveToPicker(app: App): void {
  const folder = app.listModel.hoveredFolderRel();
  if (folder !== undefined && !app.selection.size) {
    if (folder === "") { return; }
    openFolderPicker(app, `Move folder "${folderTitle(folder)}" to`, (rel) => {
      void app.taskStatus.task("move", "moving", () => moveKeys(app, [`c:${folder}`], rel === ALL ? "" : rel));
    }, { exclude: (rel) => rel === folder || rel.startsWith(folder + "/"), withAll: false });
    return;
  }
  const papers = needPapers(app);
  if (!papers.length) { return; }
  const keys = papers.map((p) => `p:${p.record.id}`);
  openFolderPicker(app, `Move ${papers.length} paper${papers.length === 1 ? "" : "s"} to`, (rel) => {
    app.selection.clear();
    void app.taskStatus.task("move", "moving", () => moveKeys(app, keys, rel === ALL ? "" : rel));
  }, { withAll: false });
}

export function confirmTrash(app: App): void {
  if (!trashSupported()) { app.taskStatus.notify("Moving to the trash is not supported on this system", "error"); return; }
  const folder = app.listModel.hoveredFolderRel();
  if (folder !== undefined && !app.selection.size) { return confirmTrashFolder(app, folder); }
  const papers = needPapers(app);
  if (!papers.length) { return; }
  app.overlay = {
    kind: "confirm",
    title: "Move to trash",
    lines: [
      papers.length === 1 ? `Move "${truncate(papers[0]!.record.title, 60)}" to the trash?` : `Move ${papers.length} papers to the trash?`,
      "The next sync removes them from Drive and from VS Code too.",
    ],
    onYes: () => {
      app.selection.clear();
      void app.taskStatus.task("trash", "moving to trash", async () => {
        const outcome = await app.ctx.papers.trashPapers(papers.map((p) => p.record.id));
        const notice = removeNotice(outcome.done, outcome.failed, (id) => papers.find((p) => p.record.id === id)?.record.title ?? id);
        if (notice) { app.taskStatus.notify(notice.text, notice.kind === "error" ? "error" : undefined); }
      });
    },
  };
}

function confirmTrashFolder(app: App, folder: string): void {
  if (folder === "") { return; }
  const node = app.ctx.store.collection(folder);
  app.overlay = {
    kind: "confirm",
    title: "Move to trash",
    lines: [
      `Move folder "${folderTitle(folder)}" and its ${node?.total ?? 0} paper${node?.total === 1 ? "" : "s"} to the trash?`,
      "The next sync removes them from Drive and from VS Code too.",
    ],
    onYes: () => void app.taskStatus.task("trash", "moving to trash", async () => {
      await app.ctx.papers.trashCollection(folder);
      app.folder = parentFolder(folder);
      app.taskStatus.notify(`Folder "${folderTitle(folder)}" moved to the trash`);
    }),
  };
}
