/** Lays out the main screen: the library panes, or the Writing pane across the papers and preview columns when it has focus. */
import type { Layout, Rect } from "../../render.js";
import { computeLayout } from "../../render.js";
import type { Focus } from "../types.js";

export interface AppLayout extends Layout {
  writing: Rect | undefined;
}

export function computeAppLayout(width: number, height: number, focus: Focus): AppLayout {
  if (focus !== "writing") { return { ...computeLayout(width, height, focus), writing: undefined }; }
  const base = computeLayout(width, height, "papers");
  const list = base.papers!;
  const end = base.preview ? base.preview.x + base.preview.w : list.x + list.w;
  return { ...base, papers: undefined, preview: undefined, writing: { ...list, w: end - list.x } };
}
