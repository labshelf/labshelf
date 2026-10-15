/** Resolves a key sequence to a binding and routes it: movement and folders, paper actions, or app-level commands. */
import type { PaperStatus } from "@labshelf/core";

import { resolveKeys, type Binding } from "../../keymap.js";
import { PREVIEW_TABS } from "../../preview.js";
import { textInput } from "../../textInput.js";
import { revealInFileManager } from "../../../platform/index.js";
import { editNote, openPdf, promptTags, setStatus } from "../actions/index.js";
import { exportName, setSort, targetsForExport, yank } from "../actions/index.js";
import { confirmTrash, cutTargets, moveToPicker, paste } from "../actions/index.js";
import { promptAdd, promptRename } from "../actions/index.js";
import { syncNow } from "../actions/index.js";
import { ALL, parentFolder } from "../types.js";
import type { App } from "../app.js";
import { findStep } from "./liveQuery.js";
import { openPrompt } from "./overlayInput.js";
import { openFolderPicker, openPaperPicker } from "./overlayPickers.js";

export function handleKey(app: App, id: string): void {
  app.pending.push(id);
  const resolution = resolveKeys(app.pending);
  if (resolution.kind === "prefix") { return; }
  const keys = app.pending;
  app.pending = [];
  if (resolution.kind === "none") {
    if (keys.length > 1 && id !== "esc") { handleKey(app, id); }
    return;
  }
  dispatch(app, resolution.binding);
}

function pageSize(app: App): number {
  return Math.max(1, (app.layout.papers ?? app.layout.folders)!.h - 1);
}

function dispatch(app: App, binding: Binding): void {
  const page = pageSize(app);
  if (dispatchNavigate(app, binding, page)) { return; }
  if (dispatchPapers(app, binding)) { return; }
  dispatchApp(app, binding);
}

function dispatchNavigate(app: App, binding: Binding, page: number): boolean {
  switch (binding.action) {
    case "down": app.listModel.move(1); return true;
    case "up": app.listModel.move(-1); return true;
    case "top": app.listModel.moveTo("top"); return true;
    case "bottom": app.listModel.moveTo("bottom"); return true;
    case "halfDown": app.listModel.move(Math.floor(page / 2)); return true;
    case "halfUp": app.listModel.move(-Math.floor(page / 2)); return true;
    case "pageDown": app.listModel.move(page); return true;
    case "pageUp": app.listModel.move(-page); return true;
    case "parent": up(app); return true;
    case "enter": down(app); return true;
    case "back": app.historyNav.historyStep("back"); return true;
    case "forward": app.historyNav.historyStep("forward"); return true;
    case "home": app.historyNav.jumpToFolder(ALL); return true;
    case "toggleFlatten":
      app.flatten = !app.flatten;
      app.taskStatus.notify(app.flatten ? "Including papers from subfolders" : "Showing only the papers directly in each folder");
      return true;
    case "previewDown": app.previewScroll += 3; return true;
    case "previewUp": app.previewScroll = Math.max(0, app.previewScroll - 3); return true;
    case "nextTab": app.previewTab = (app.previewTab + 1) % PREVIEW_TABS.length; app.previewScroll = 0; return true;
    case "prevTab": app.previewTab = (app.previewTab + PREVIEW_TABS.length - 1) % PREVIEW_TABS.length; app.previewScroll = 0; return true;
    case "reveal": reveal(app); return true;
    default: return false;
  }
}

function reveal(app: App): void {
  const rel = app.listModel.hoveredFolderRel();
  const paper = app.focus === "papers" ? app.listModel.hoveredPaper() : undefined;
  if (paper) { revealInFileManager(paper.record.path); } else if (rel !== undefined) { revealInFileManager(app.ctx.paths.collectionDir(rel)); }
}

function dispatchPapers(app: App, binding: Binding): boolean {
  switch (binding.action) {
    case "open": { const paper = app.listModel.targetPapers()[0]; if (paper) { openPdf(app, paper); } return true; }
    case "filter":
      app.focus = "papers";
      app.filterBeforeEdit = app.filter;
      app.inline = { purpose: "filter", input: textInput(app.filter) };
      return true;
    case "find": app.focus = "papers"; app.inline = { purpose: "find", input: textInput("") }; return true;
    case "findNext": findStep(app, 1); return true;
    case "findPrev": findStep(app, -1); return true;
    case "search":
      if (app.search === undefined) { app.historyNav.searchOrigin = { folder: app.folder, search: undefined }; }
      app.focus = "papers";
      app.inline = { purpose: "search", input: textInput(app.search ?? "") };
      return true;
    case "jumpCollection": openFolderPicker(app, "Jump to folder", (rel) => app.historyNav.jumpToFolder(rel)); return true;
    case "jumpPaper": openPaperPicker(app); return true;
    case "toggleSelect": app.selectionState.toggleSelect(); return true;
    case "visual": app.selectionState.toggleVisual(); return true;
    case "selectAll":
      if (app.focus === "papers") { for (const paper of app.listModel.papers()) { app.selection.add(paper.record.id); } }
      return true;
    case "status": setStatus(app, binding.arg as PaperStatus); return true;
    case "tags": promptTags(app); return true;
    case "note": editNote(app); return true;
    case "cut": cutTargets(app); return true;
    case "paste": paste(app); return true;
    case "moveTo": moveToPicker(app); return true;
    case "trash": confirmTrash(app); return true;
    case "add": promptAdd(app); return true;
    case "rename": promptRename(app); return true;
    case "exportBib":
      openPrompt(app, "export", "Export BibTeX", `./${exportName(app)}.bib`,
        `${targetsForExport(app).length} entries; the path is relative to ${process.cwd()}`);
      return true;
    case "yank": void yank(app, binding.arg ?? "keys"); return true;
    case "sort": setSort(app, binding.arg ?? "title"); return true;
    default: return false;
  }
}

function dispatchApp(app: App, binding: Binding): void {
  switch (binding.action) {
    case "escape": return escape(app);
    case "sync": void syncNow(app); return;
    case "reload": void app.ctx.store.reload().then(() => app.taskStatus.notify("Library reloaded")); return;
    case "command":
      openPrompt(app, "command", "Command", "",
        "sync · login · logout · reload · export <file> · mkdir <name> · add <input> · sort <key> [desc] · cd <folder> · where · q");
      return;
    case "help": app.overlay = { kind: "help", scroll: 0 }; return;
    case "quit": void app.quit(); return;
    case "suspend":
      if (app.ctx.sync.status().state === "syncing") { app.taskStatus.notify("Wait for the sync to finish before suspending", "warn"); return; }
      app.term.stopJob();
      return;
  }
}

function escape(app: App): void {
  if (app.selectionState.visualAnchor !== undefined) { return app.selectionState.exitVisual(); }
  if (app.selection.size) { app.selection.clear(); return; }
  if (app.filter) {
    app.filter = "";
    return;
  }
  if (app.cut) {
    app.cut = undefined;
    app.taskStatus.notify("Cut cleared");
    return;
  }
  if (app.search !== undefined) { app.historyNav.leaveSearch(); }
}

function up(app: App): void {
  if (app.focus === "papers") {
    if (app.search !== undefined) { app.historyNav.leaveSearch(); return; }
    app.focus = "folders";
    return;
  }
  app.listModel.setFolder(parentFolder(app.folder));
}

export function down(app: App): void {
  if (app.focus === "folders") {
    app.focus = "papers";
    return;
  }
  const paper = app.listModel.hoveredPaper();
  if (paper) { openPdf(app, paper); }
}
