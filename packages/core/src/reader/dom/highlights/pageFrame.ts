// Maps viewport rectangles into a page's 0..1 space, the space annotation positions are stored in.
import type { AnnotationPosition } from "../../../model/index.js";

export interface PageFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * pdf.js gives `.page` a border and lays the canvas and text layer over its content box, so the frame is that box.
 * @returns the page's content box in viewport pixels, or null while the page has no size.
 */
export function pageFrame(page: HTMLElement): PageFrame | null {
  const rect = page.getBoundingClientRect();
  const width = page.clientWidth;
  const height = page.clientHeight;
  if (width <= 0 || height <= 0) { return null; }
  return { left: rect.left + page.clientLeft, top: rect.top + page.clientTop, width, height };
}

/**
 * @returns the part of `rect` inside the frame, normalised to 0..1 of the page; null when nothing of it is inside.
 */
export function boxInPage(rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">, frame: PageFrame): AnnotationPosition | null {
  const x1 = clamp01((rect.left - frame.left) / frame.width);
  const x2 = clamp01((rect.right - frame.left) / frame.width);
  const y1 = clamp01((rect.top - frame.top) / frame.height);
  const y2 = clamp01((rect.bottom - frame.top) / frame.height);
  if (x2 <= x1 || y2 <= y1) { return null; }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
