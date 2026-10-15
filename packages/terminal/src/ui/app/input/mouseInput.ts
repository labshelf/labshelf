/** Routes mouse input: clicking a row in a pane, and the wheel scrolling the pane under the pointer. */
import type { MouseEvent } from "../../../tui/index.js";
import type { Rect } from "../../render.js";
import type { App } from "../app.js";
import { down } from "./keyDispatch.js";

export function handleMouse(app: App, event: MouseEvent): void {
  if (app.overlay) { return; }
  const { folders, papers, preview } = app.layout;
  const inside = (rect: Rect | undefined): rect is Rect => Boolean(rect)
    && event.x >= rect!.x && event.x < rect!.x + rect!.w && event.y >= rect!.y && event.y < rect!.y + rect!.h;
  if (event.kind === "wheel-down" || event.kind === "wheel-up") {
    const delta = event.kind === "wheel-down" ? 3 : -3;
    if (inside(preview)) {
      app.previewScroll = Math.max(0, app.previewScroll + delta);
    } else {
      app.focus = inside(folders) ? "folders" : "papers";
      app.listModel.move(delta);
    }
    return;
  }
  if (event.kind !== "down" || event.button !== 0) { return; }
  if (inside(folders)) {
    const row = app.listModel.folderRows()[app.listModel.folderOffset + event.y - folders.y];
    app.focus = "folders";
    if (row) { app.listModel.setFolder(row.key); }
  } else if (inside(papers)) {
    const index = app.listModel.cursorState().offset + (event.y - papers.y);
    if (index < app.listModel.papers().length) {
      if (app.focus === "papers" && index === app.listModel.cursor()) { down(app); } else { app.listModel.setPaperCursor(index); }
    }
    app.focus = "papers";
  }
}
