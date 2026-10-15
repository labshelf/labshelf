/** Per-paper field edits: opening the PDF, marking status, editing tags and editing the note in $EDITOR. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PaperEntry, PaperStatus } from "@labshelf/core";
import { paperFiles, paperLink } from "@labshelf/core";

import { openExternal, runEditor } from "../../../platform/index.js";
import { truncate } from "../../../tui/index.js";
import type { App } from "../app.js";
import { openPrompt } from "../input/index.js";

export function openPdf(app: App, paper: PaperEntry): void {
  if (paper.record.hasPdf === false) {
    const link = paperLink(paper.record);
    app.taskStatus.notify(`No PDF on this device for ${paper.record.id}${link ? " — y d copies its link" : ""}`, "warn");
    return;
  }
  const viewer = process.env["LABSHELF_PDF_VIEWER"] || app.ctx.config.terminal?.pdfViewer;
  openExternal(paperFiles(paper.record.path, path.join).pdf, viewer);
  app.taskStatus.notify(`Opened ${truncate(paper.record.title, 60)}`);
}

export function needPapers(app: App): PaperEntry[] {
  const papers = app.listModel.targetPapers();
  if (!papers.length && app.focus === "folders") { app.taskStatus.notify("Move to the papers (l) or select some first", "warn"); }
  return papers;
}

export function setStatus(app: App, status: PaperStatus): void {
  const papers = needPapers(app);
  if (!papers.length) { return; }
  void app.taskStatus.task("status", "saving", async () => {
    const outcome = await app.ctx.papers.setStatus(papers.map((p) => p.record.id), status);
    app.taskStatus.notifyBatch(outcome.done.length, outcome.failed, `marked ${status}`);
    app.selection.clear();
  });
}

export function promptTags(app: App): void {
  const papers = needPapers(app);
  if (!papers.length) { return; }
  if (papers.length === 1) {
    const record = papers[0]!.record;
    openPrompt(app, "tags", `Tags of ${truncate(record.title, 50)}`, (record.tags ?? []).join(", ") + (record.tags?.length ? ", " : ""),
      "Comma-separated; Tab completes existing tags", [record.id]);
  } else {
    openPrompt(app, "tagsBatch", `Tags of ${papers.length} papers`, "+", "+tag adds, -tag removes; Tab completes", papers.map((p) => p.record.id));
  }
}

export function editNote(app: App): void {
  const paper = needPapers(app)[0];
  if (!paper) { return; }
  const record = paper.record;
  const file = path.join(os.tmpdir(), `labshelf-note-${record.id.replace(/[^\w.-]/g, "_")}.md`);
  const before = record.note ?? "";
  void (async () => {
    await fs.writeFile(file, before);
    const ok = app.term.suspend(() => runEditor(file));
    app.image = undefined;
    const after = (await fs.readFile(file, "utf8")).replace(/\s+$/, "");
    await fs.rm(file, { force: true });
    if (!ok) {
      app.taskStatus.notify("The editor exited with an error; note not saved", "warn");
    } else if (after !== before.replace(/\s+$/, "")) {
      await app.ctx.papers.updateFields(record.id, { note: after });
      app.taskStatus.notify(after ? "Note saved" : "Note cleared");
    }
    app.render();
  })().catch((error: unknown) => app.taskStatus.fail(error));
}
