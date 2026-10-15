/** Draws the status bar: mode, position, selection/cut counts, pending keys or the latest message, and the sync segment. */
import type { Screen, Style } from "../../../tui/index.js";
import { stringWidth, truncate } from "../../../tui/index.js";
import type { SyncStatus } from "@labshelf/core";
import { relativeTime } from "@labshelf/core";

import { keyLabel, resolveKeys } from "../../keymap.js";
import { drawField, type InlineInput } from "../../overlays.js";
import { drawSegments, type Rect } from "../../render.js";
import { theme } from "../../theme.js";
import type { App } from "../app.js";
import { appName } from "../actions/index.js";

export function drawStatus(app: App, screen: Screen, rect: Rect): void {
  const y = rect.y;
  screen.fill(rect.x, y, rect.w, 1);
  if (app.inline) { return drawInline(app, screen, rect, app.inline); }
  const mode = app.selectionState.visualAnchor !== undefined ? "VISUAL" : app.filter ? "FILTER" : app.search !== undefined ? "SEARCH" : "NORMAL";
  const left: Array<{ text: string; style?: Style }> = [{ text: ` ${mode} `, style: theme.mode[mode]! }];
  if (app.focus === "folders") {
    left.push({ text: ` folder ${app.listModel.folderIndex() + 1}/${app.listModel.folderRows().length} `, style: theme.dim });
  } else {
    const count = app.listModel.papers().length;
    left.push({ text: ` ${count ? app.listModel.cursor() + 1 : 0}/${count} `, style: theme.dim });
  }
  if (app.selection.size) { left.push({ text: ` ${app.selection.size} selected `, style: theme.selectedMark }); }
  if (app.cut?.length) { left.push({ text: ` ${app.cut.length} cut `, style: theme.cutMark }); }
  if (app.filter) { left.push({ text: ` f: ${truncate(app.filter, 24)} `, style: theme.warn }); }
  if (app.pending.length) {
    pushPendingHints(app, left);
  } else if (app.message && app.message.until > app.taskStatus.now()) {
    const style = app.message.level === "error" ? theme.error : app.message.level === "warn" ? theme.warn : theme.info;
    left.push({ text: " " + app.message.text, style });
  }
  const right = statusRight(app);
  const rightWidth = right.reduce((w, s) => w + stringWidth(s.text), 0);
  drawSegments(screen, rect.x, y, rect.x + rect.w - rightWidth - 1, left);
  drawSegments(screen, rect.x + rect.w - rightWidth, y, rect.x + rect.w, right);
}

function drawInline(app: App, screen: Screen, rect: Rect, inline: InlineInput): void {
  const y = rect.y;
  const label = inline.purpose === "filter" ? " FILTER " : inline.purpose === "find" ? " FIND " : " SEARCH ";
  const style = theme.mode[inline.purpose === "search" ? "SEARCH" : "FILTER"]!;
  const col = screen.text(0, y, label, style) + 1;
  const count = inline.purpose === "find" ? "" : ` ${app.listModel.papers().length} `;
  drawField(screen, col, y, rect.w - col - stringWidth(count), inline.input);
  screen.text(rect.w - stringWidth(count), y, count, theme.dim);
}

function pushPendingHints(app: App, left: Array<{ text: string; style?: Style }>): void {
  const hints = resolveKeys(app.pending);
  left.push({ text: ` ${keyLabel(app.pending)} → `, style: theme.key });
  for (const option of (hints.kind === "prefix" ? hints.options : []).slice(0, 8)) {
    left.push({ text: option.keys[app.pending.length]!, style: theme.key });
    left.push({ text: ` ${option.desc.replace(/^(Mark|Copy|Sort by|Go to) /, "")}  `, style: theme.dim });
  }
}

function statusRight(app: App): Array<{ text: string; style?: Style }> {
  const out: Array<{ text: string; style?: Style }> = [];
  for (const label of app.tasks.values()) { out.push({ text: ` ${label}… `, style: theme.warn }); }
  out.push({ text: ` ${app.sort.key}${app.sort.reverse ? "↓" : "↑"} `, style: theme.dim });
  out.push(syncSegment(app.ctx.sync.status(), app.taskStatus.now()));
  out.push({ text: " ? help ", style: theme.dim });
  return out;
}

/**
 * The sync part of the status bar.
 * @returns the segment
 */
export function syncSegment(status: SyncStatus, now: number): { text: string; style: Style } {
  switch (status.state) {
    case "unconfigured": return { text: " Drive: not set up ", style: theme.sync.off };
    case "disconnected": return { text: " Drive: signed out ", style: theme.sync.off };
    case "syncing": return { text: " syncing… ", style: theme.sync.busy };
    case "waiting": return { text: ` ${appName(status.holder?.app)} syncing `, style: theme.sync.busy };
    case "error": return { text: " sync failed ", style: theme.sync.error };
    default: {
      const last = status.lastRun;
      if (!last) { return { text: " Drive: not synced yet ", style: theme.sync.off }; }
      const by = last.app === "terminal" ? "" : ` (${last.app === "vscode" ? "VS Code" : last.app})`;
      return { text: ` synced ${(relativeTime(last.finishedAt, now) || "never")}${by} `, style: theme.sync.ok };
    }
  }
}
