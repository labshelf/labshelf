// Draws the box of a PDF area over its page, shared by the change marks and the problem marks.
import type { PageArea } from "../index.js";
import { derivePixelOffset, type PageViewLike } from "./navigation/navigation.js";

/**
 * Positioned in percent of the page, so the mark keeps its place while pdf.js scales the page before re-rendering it.
 * A `marginBar` sits just right of the area and leaves its width to CSS.
 */
export function renderAreaMark(viewport: PageViewLike["viewport"], area: PageArea, options: { className: string; marginBar?: boolean }): HTMLElement {
  const [x1, y1] = derivePixelOffset(viewport, { page: area.page, x: area.left, y: area.top });
  const [x2, y2] = derivePixelOffset(viewport, { page: area.page, x: area.right, y: area.bottom });
  const mark = document.createElement("div");
  mark.className = options.className;
  mark.style.left = `${((options.marginBar ? Math.max(x1, x2) : Math.min(x1, x2)) / viewport.width) * 100}%`;
  mark.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
  if (!options.marginBar) { mark.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`; }
  mark.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
  return mark;
}
