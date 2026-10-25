/** Builds the next frame: header, folders, papers or writing, preview, separators, status bar and, if open, the overlay. */
import { Screen } from "../../../screen/index.js";
import { drawOverlay } from "../../overlays.js";
import { drawSeparators } from "../../render.js";
import type { ThumbnailPlan } from "../screenModel.js";
import type { App } from "../app.js";
import { drawHeader } from "./header.js";
import { drawFolders } from "./folders.js";
import { drawPapers } from "./papers.js";
import { drawPreview } from "./preview.js";
import { drawStatusBar } from "./statusBar.js";
import { drawWriting } from "./writing.js";

/**
 * Builds the next frame.
 * @returns the screen and the thumbnail to draw over it, if any
 */
export function createFrame(app: App): { screen: Screen; image: ThumbnailPlan | undefined } {
  const screen = new Screen(app.size.cols, app.size.rows);
  const layout = app.layout;
  drawHeader(app, screen, layout.header);
  if (layout.folders) { drawFolders(app, screen, layout.folders); }
  if (layout.papers) { drawPapers(app, screen, layout.papers); }
  if (layout.writing) { drawWriting(app, screen, layout.writing); }
  let image: ThumbnailPlan | undefined;
  if (layout.preview) { image = drawPreview(app, screen, layout.preview); }
  drawSeparators(screen, layout.writing ? { ...layout, papers: layout.writing } : layout);
  drawStatusBar(app, screen, layout.status);
  if (app.overlay) {
    drawOverlay(screen, app.overlay);
    image = undefined;
  }
  return { screen, image };
}
