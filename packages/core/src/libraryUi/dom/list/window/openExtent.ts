// Measures the open paper's file tray, the one variable-height block in the list, and maps scroll offsets around it.
import { paperRowOf } from "../tree/index.js";

/** The open paper's tray: its rendered height in px and its row count. */
export interface OpenExtent {
  id: string | null;
  height: number;
  rows: number;
}

export const NO_EXTENT: OpenExtent = { id: null, height: 0, rows: 0 };

/**
 * Maps a physical scroll offset to the offset in a list of fixed-height rows without the tray: offsets inside the tray
 * collapse onto the row after the open one. `openRow` is -1 when no paper is open.
 */
export function toLogical(scrollTop: number, openRow: number, rowHeight: number, extra: number): number {
  if (openRow < 0) return scrollTop;
  const openEnd = (openRow + 1) * rowHeight;
  if (scrollTop <= openEnd) return scrollTop;
  return scrollTop <= openEnd + extra ? openEnd : scrollTop - extra;
}

/** The rendered tray of paper `id`, or null when its row is not rendered (the last measurement then still holds). */
export function measureOpenExtent(list: HTMLElement, id: string | null): OpenExtent | null {
  if (!id) return NO_EXTENT;
  const tray = paperRowOf(list, id)?.closest(".paper-row")?.querySelector<HTMLElement>(".paper-children");
  if (!tray) return null;
  return { id, height: tray.offsetHeight, rows: tray.querySelectorAll('[role="row"]').length };
}
