/** Draws the header: the brand mark, the breadcrumb of the hovered folder or the search query, and the library name. */
import * as path from "node:path";

import type { Screen, Style } from "../../../screen/index.js";
import { deriveStringWidth } from "../../../screen/index.js";
import { drawSegments, type Rect } from "../../render.js";
import { theme } from "../../theme.js";
import { ALL, formatFolderTitle } from "../screenModel.js";
import type { App } from "../app.js";

export function drawHeader(app: App, screen: Screen, rect: Rect): void {
  const segments: Array<{ text: string; style?: Style }> = [{ text: " LabShelf ", style: theme.brand }, { text: " " }];
  if (app.search !== undefined) {
    const count = app.listModel.papers().length;
    segments.push({ text: "search › ", style: theme.crumb });
    segments.push({ text: app.search || "(everything)", style: theme.crumbCurrent });
    segments.push({ text: `  ${count} result${count === 1 ? "" : "s"}`, style: theme.dim });
  } else if (app.folder === ALL || app.folder === "") {
    segments.push({ text: formatFolderTitle(app.folder), style: theme.crumbCurrent });
  } else {
    const parts = app.folder.split("/");
    parts.forEach((part, i) => {
      if (i) { segments.push({ text: " › ", style: theme.dim }); }
      segments.push({ text: part, style: i === parts.length - 1 ? theme.crumbCurrent : theme.crumb });
    });
    if (app.flatten) { segments.push({ text: "  + subfolders", style: theme.dim }); }
  }
  const right = ` ${path.basename(app.ctx.paths.root)} `;
  drawSegments(screen, rect.x, rect.y, rect.x + rect.w - deriveStringWidth(right), segments);
  screen.text(rect.x + rect.w - deriveStringWidth(right), rect.y, right, theme.dim);
}
