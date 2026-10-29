/** Edits per-paper fields: opening the PDF, marking status, editing tags and opening the paper's notes.qmd in $EDITOR. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PaperEntry, ReadingStatus } from "@labshelf/core";
import { createPaperFiles, derivePaperUrl } from "@labshelf/core";

import { openExternal, runEditor } from "../../../platform/index.js";
import { formatTruncated } from "../../../screen/index.js";
import type { App } from "../app.js";
import { openAsk } from "../input/index.js";

export function openPdf(app: App, paper: PaperEntry): void {
  if (paper.record.hasPdf === false) {
    const link = derivePaperUrl(paper.record);
    app.taskStatus.notify(`No PDF on this device for ${paper.record.id}${link ? " — y d copies its link" : ""}`, "warn");
    return;
  }
  const viewer = process.env["LABSHELF_PDF_VIEWER"] || app.ctx.config.terminal?.pdfViewer;
  openExternal(createPaperFiles(paper.record.path, path.join).pdf, viewer);
  app.taskStatus.notify(`Opened ${formatTruncated(paper.record.title, 60)}`);
}

export function readSelectedPapers(app: App): PaperEntry[] {
  const papers = app.listModel.targetPapers();
  if (!papers.length && app.focus === "folders") { app.taskStatus.notify("Move to the papers (l) or select some first", "warn"); }
  return papers;
}

export function setReadingStatus(app: App, status: ReadingStatus): void {
  const papers = readSelectedPapers(app);
  if (!papers.length) { return; }
  void app.taskStatus.task("status", "saving", async () => {
    const outcome = await app.ctx.papers.setStatus(papers.map((p) => p.record.id), status);
    app.taskStatus.notifyBatch(outcome.done.length, outcome.failed, `marked ${status}`);
    app.selection.clear();
  });
}

export function askTags(app: App): void {
  const papers = readSelectedPapers(app);
  if (!papers.length) { return; }
  if (papers.length === 1) {
    const record = papers[0]!.record;
    openAsk(app, "tags", `Tags of ${formatTruncated(record.title, 50)}`, (record.tags ?? []).join(", ") + (record.tags?.length ? ", " : ""),
      "Comma-separated; Tab completes existing tags", [record.id]);
  } else {
    openAsk(app, "tagsBatch", `Tags of ${papers.length} papers`, "+", "+tag adds, -tag removes; Tab completes", papers.map((p) => p.record.id));
  }
}

export function updateNote(app: App): void {
  const paper = readSelectedPapers(app)[0];
  if (!paper) { return; }
  const id = paper.record.id;
  const file = app.ctx.paths.layout.paperNotesPath(id);
  void (async () => {
    // The editor opens notes.qmd itself; a paper without one gets an empty file first.
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "", { flag: "a" });
    const ok = app.term.suspend(() => runEditor(file));
    app.image = undefined;
    if (!ok) {
      app.taskStatus.notify("The editor exited with an error; notes may not be saved", "warn");
    } else {
      // notes.qmd is not metadata.yaml, so the store does not fire: drop the cached notes and re-index the search text here.
      app.notes.delete(id);
      await app.ctx.indexSearchText();
      app.taskStatus.notify("Notes reloaded");
    }
    app.render();
  })().catch((error: unknown) => app.taskStatus.fail(error));
}
