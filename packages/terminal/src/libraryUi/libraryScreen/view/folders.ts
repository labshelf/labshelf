/** Draws the folders pane: the hovered row, the scroll window around it, and which rows are cut. */
import type { Screen } from "../../../screen/index.js";
import { drawFolderRow, type Rect } from "../../render.js";
import type { App } from "../app.js";

const SCROLL_MARGIN = 4;

export function drawFolders(app: App, screen: Screen, rect: Rect): void {
  const rows = app.listModel.folderRows();
  const index = app.listModel.folderIndex();
  const margin = Math.min(SCROLL_MARGIN, Math.floor((rect.h - 1) / 2));
  if (index < app.listModel.folderOffset + margin) { app.listModel.folderOffset = index - margin; }
  if (index > app.listModel.folderOffset + rect.h - 1 - margin) { app.listModel.folderOffset = index - rect.h + 1 + margin; }
  app.listModel.folderOffset = Math.max(0, Math.min(app.listModel.folderOffset, rows.length - rect.h));
  const cut = new Set(app.cut ?? []);
  for (let row = 0; row < rect.h; row++) {
    const i = app.listModel.folderOffset + row;
    const folder = rows[i];
    if (!folder) { break; }
    drawFolderRow(screen, rect.x, rect.y + row, rect.w, folder, {
      hovered: i === index && app.search === undefined,
      dimHover: app.focus !== "folders",
      selected: false,
      cut: cut.has(`c:${folder.key}`),
    });
  }
}
