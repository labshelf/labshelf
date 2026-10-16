// Converts the places a reader points at into the page areas a preview host understands.
import type { PageArea } from "../../../index.js";
import { pagePointAt, type PageViewportLike } from "../../navigation/index.js";

/** The area of a PDF annotation `rect`, which is in user space with y growing upwards, as top-left page points. */
export function rectArea(page: number, rect: number[], viewBox: number[]): PageArea {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
  const [left = 0, , , top = 0] = viewBox;
  return {
    page,
    left: Math.min(x0, x1) - left,
    right: Math.max(x0, x1) - left,
    top: top - Math.max(y0, y1),
    bottom: top - Math.min(y0, y1),
  };
}

/** The area of an on-screen rectangle over a page; rotation can swap its corners, so the area is ordered afterwards. */
export function screenArea(page: number, viewport: PageViewportLike, pageEl: HTMLElement, rect: DOMRect): PageArea {
  const box = pageEl.getBoundingClientRect();
  const offsetX = box.left + pageEl.clientLeft;
  const offsetY = box.top + pageEl.clientTop;
  const a = pagePointAt(page, viewport, rect.left - offsetX, rect.top - offsetY);
  const b = pagePointAt(page, viewport, rect.right - offsetX, rect.bottom - offsetY);
  return { page, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
}
