/** Draws the Writing pane: one row per project with its name, format and main file. */
import type { ProjectEntry } from "@labshelf/core";

import type { Screen } from "../../../tui/index.js";
import { stringWidth, truncate } from "../../../tui/index.js";
import { mergeStyle } from "../../../tui/index.js";
import type { Rect } from "../../render.js";
import { theme } from "../../theme.js";
import { projectName } from "../state/index.js";
import type { App } from "../app.js";

const SCROLL_MARGIN = 4;
const FORMAT_WIDTH = 6;

export function drawWriting(app: App, screen: Screen, rect: Rect): void {
  const model = app.writing;
  if (!model.projects.length) { screen.text(rect.x + 1, rect.y, "No projects", theme.dim); return; }
  const margin = Math.min(SCROLL_MARGIN, Math.floor((rect.h - 1) / 2));
  if (model.index < model.offset + margin) { model.offset = model.index - margin; }
  if (model.index > model.offset + rect.h - 1 - margin) { model.offset = model.index - rect.h + 1 + margin; }
  model.offset = Math.max(0, Math.min(model.offset, model.projects.length - rect.h));
  for (let row = 0; row < rect.h; row++) {
    const i = model.offset + row;
    const entry = model.projects[i];
    if (!entry) { break; }
    drawRow(screen, rect, rect.y + row, entry, i === model.index);
  }
}

function drawRow(screen: Screen, rect: Rect, y: number, entry: ProjectEntry, hovered: boolean): void {
  const hover = hovered ? theme.hover : undefined;
  const style = (base: Parameters<typeof mergeStyle>[0]) => (hover ? mergeStyle(base, hover) : base ?? {});
  screen.fill(rect.x, y, rect.w, 1, hover);
  const inner = rect.w - 2;
  const format = entry.kind === "ready" ? entry.settings.format : "broken";
  const detail = entry.kind === "ready" ? entry.main ?? "" : entry.reason;
  const detailWidth = Math.min(stringWidth(detail), Math.floor(inner / 2));
  const nameWidth = Math.max(1, inner - FORMAT_WIDTH - detailWidth - 2);
  screen.text(rect.x + 1, y, truncate(projectName(entry), nameWidth), style(theme.collection));
  const formatX = rect.x + 1 + nameWidth + 1;
  if (inner > FORMAT_WIDTH + 2) { screen.text(formatX, y, format, style(entry.kind === "ready" ? theme.label : theme.error)); }
  if (detailWidth) { screen.text(formatX + FORMAT_WIDTH + 1, y, truncate(detail, detailWidth), style(entry.kind === "ready" ? theme.text : theme.warn)); }
}
