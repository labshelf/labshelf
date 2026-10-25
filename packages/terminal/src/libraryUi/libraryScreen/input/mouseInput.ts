/** Routes mouse input: clicking a row in a pane, and the wheel scrolling the pane under the pointer. */
import type { MouseEvent } from "../../../screen/index.js";
import type { Rect } from "../../render.js";
import type { App } from "../app.js";
import { moveDown } from "./runShortcut.js";

export function onMouseInput(app: App, event: MouseEvent): void {
  if (app.overlay) { return; }
  const { folders, papers, preview, writing } = app.layout;
  const inside = (rect: Rect | undefined): rect is Rect => Boolean(rect)
    && event.x >= rect!.x && event.x < rect!.x + rect!.w && event.y >= rect!.y && event.y < rect!.y + rect!.h;
  if (event.kind === "wheel-down" || event.kind === "wheel-up") {
    const delta = event.kind === "wheel-down" ? 3 : -3;
    if (inside(preview)) {
      app.previewScroll = Math.max(0, app.previewScroll + delta);
    } else {
      app.focus = inside(folders) ? "folders" : inside(writing) ? "writing" : "papers";
      app.listModel.move(delta);
    }
    return;
  }
  if (event.kind !== "down" || event.button !== 0) { return; }
  if (inside(folders)) {
    const row = app.listModel.folderRows()[app.listModel.folderOffset + event.y - folders.y];
    app.focus = "folders";
    if (row) { app.listModel.setFolder(row.key); }
  } else if (inside(writing)) {
    const index = app.writing.offset + (event.y - writing.y);
    if (index < app.writing.projects.length) { app.writing.index = index; }
    app.focus = "writing";
  } else if (inside(papers)) {
    const index = app.listModel.cursorState().offset + (event.y - papers.y);
    if (index < app.listModel.papers().length) {
      if (app.focus === "papers" && index === app.listModel.cursor()) { moveDown(app); } else { app.listModel.setPaperCursor(index); }
    }
    app.focus = "papers";
  }
}
