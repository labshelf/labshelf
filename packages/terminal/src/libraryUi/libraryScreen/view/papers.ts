/** Draws the papers pane: the rows, the scroll window around the cursor, and the empty-list hints. */
import type { Screen } from "../../../screen/index.js";
import { drawLines, drawPaperRow, type Rect } from "../../render.js";
import type { Line } from "../../preview.js";
import { theme } from "../../theme.js";
import { ALL } from "../screenModel.js";
import type { App } from "../app.js";

const SCROLL_MARGIN = 4;

export function drawPapers(app: App, screen: Screen, rect: Rect): void {
  const papers = app.listModel.papers();
  const state = app.listModel.cursorState();
  const index = app.listModel.cursor();
  if (!papers.length) { return drawEmptyHint(app, screen, rect); }
  const margin = Math.min(SCROLL_MARGIN, Math.floor((rect.h - 1) / 2));
  if (index < state.offset + margin) { state.offset = index - margin; }
  if (index > state.offset + rect.h - 1 - margin) { state.offset = index - rect.h + 1 + margin; }
  state.offset = Math.max(0, Math.min(state.offset, papers.length - rect.h));
  const cut = new Set(app.cut ?? []);
  const showFolder = app.search !== undefined || app.folder === ALL || app.flatten;
  for (let row = 0; row < rect.h; row++) {
    const i = state.offset + row;
    const paper = papers[i];
    if (!paper) { break; }
    const detail = showFolder ? (paper.collection.split("/").pop() || "unfiled") : undefined;
    drawPaperRow(screen, rect.x, rect.y + row, rect.w, paper, {
      hovered: i === index,
      dimHover: app.focus !== "papers",
      selected: app.selection.has(paper.record.id),
      cut: cut.has(`p:${paper.record.id}`),
    }, detail);
  }
}

function drawEmptyHint(app: App, screen: Screen, rect: Rect): void {
  const hint: Line[] = app.filter
    ? [[{ text: "No paper matches the filter.", style: theme.dim }], [{ text: "Esc clears it.", style: theme.dim }]]
    : app.search !== undefined
      ? [[{ text: "Nothing found.", style: theme.dim }]]
      : [[{ text: "No papers here.", style: theme.dim }], [], [{ text: "a", style: theme.key }, { text: " adds a PDF, a DOI or an arXiv id", style: theme.dim }]];
  drawLines(screen, { ...rect, x: rect.x + 1, w: rect.w - 1 }, hint);
}
