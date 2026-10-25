/** Draws the preview pane: the folder summary or the library overview, and the paper's Info/Abstract/Notes/BibTeX tabs. */
import type { PaperSidecar, PaperEntry } from "@labshelf/core";
import { createPaperComparator, createPaperFiles } from "@labshelf/core";
import * as path from "node:path";

import { deriveImageFit, readPngSize, type CellRect } from "../../../screen/index.js";
import type { Screen } from "../../../screen/index.js";
import { drawLines, type Rect } from "../../render.js";
import { createFolderPreview, createLibraryOverview, createPaperPreview, PREVIEW_TABS, createTabBar } from "../../preview.js";
import { ALL, formatFolderTitle, type ThumbnailPlan } from "../screenModel.js";
import type { App } from "../app.js";

export function drawPreview(app: App, screen: Screen, rect: Rect): ThumbnailPlan | undefined {
  const inner = { x: rect.x + 1, y: rect.y, w: rect.w - 1, h: rect.h };
  if (app.focus === "folders" && app.search === undefined) { return drawFolderSide(app, screen, inner); }
  const paper = app.listModel.hoveredPaper();
  if (!paper) { return undefined; }
  return drawPaperSide(app, screen, inner, paper);
}

function drawFolderSide(app: App, screen: Screen, inner: Rect): undefined {
  const snapshot = app.ctx.store.snapshot;
  if (app.folder === ALL) {
    drawLines(screen, inner, createLibraryOverview(snapshot), app.previewScroll);
    return undefined;
  }
  const node = snapshot.collections.get(app.folder);
  if (node) {
    const direct = node.paperIds.map((id) => snapshot.papers.get(id)).filter((p): p is PaperEntry => Boolean(p)).sort(createPaperComparator(app.sort));
    const lines = createFolderPreview(node, snapshot, direct, formatFolderTitle(app.folder), { directOnly: app.folder === "" });
    drawLines(screen, inner, lines, app.previewScroll);
  }
  return undefined;
}

function drawPaperSide(app: App, screen: Screen, inner: Rect, paper: PaperEntry): ThumbnailPlan | undefined {
  const data = sidecarFor(app, paper.record.id);
  const tab = PREVIEW_TABS[app.previewTab]!;
  drawLines(screen, { ...inner, h: 1 }, [createTabBar(tab, data?.annotations.length ?? 0)]);
  const body = { ...inner, y: inner.y + 2, h: inner.h - 2 };
  const bibtex = tab === "BibTeX" ? app.ctx.papers.bibtexFor([paper.record]) : "";
  const preview = createPaperPreview(paper, data, tab, body.w, bibtex);
  app.previewScroll = Math.min(app.previewScroll, Math.max(0, preview.lines.length - 1));
  const used = drawLines(screen, body, preview.lines, app.previewScroll);
  if (!preview.wantsImage || app.ctx.imageProtocol === "none" || app.overlay || app.previewScroll > 0) { return undefined; }
  const box: CellRect = { x: body.x, y: body.y + used + 1, cols: body.w, rows: body.h - used - 2 };
  if (box.rows < 8 || box.cols < 12 || paper.pdfBytes === undefined) { return undefined; }
  return thumbnailFor(app, paper, box);
}

// Caches sidecar data per paper id; a miss kicks off the load and redraws once it resolves.
function sidecarFor(app: App, id: string): PaperSidecar | undefined {
  const cached = app.sidecars.get(id);
  if (cached) { return cached; }
  if (!app.sidecarLoading.has(id)) {
    app.sidecarLoading.add(id);
    void app.ctx.sidecars.load(id).then((data) => {
      app.sidecars.set(id, data);
      app.sidecarLoading.delete(id);
      app.scheduleRender();
    }, () => app.sidecarLoading.delete(id));
  }
  return undefined;
}

function thumbnailFor(app: App, paper: PaperEntry, box: CellRect): ThumbnailPlan | undefined {
  const request = { pdfPath: createPaperFiles(paper.record.path, path.join).pdf, sizeBytes: paper.pdfBytes ?? 0, mtimeMs: paper.modifiedMs };
  const png = app.ctx.thumbnails.peek(request);
  if (!png) {
    void app.ctx.thumbnails.get(request).then((result) => { if (result) { app.scheduleRender(); } });
    return undefined;
  }
  const size = readPngSize(png);
  if (!size) { return undefined; }
  const aspect = Number(process.env["LABSHELF_CELL_ASPECT"]) || undefined;
  return { key: `${request.pdfPath}:${request.sizeBytes}`, rect: deriveImageFit(size, box, aspect), png };
}
