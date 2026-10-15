// Converts between the host's page points (points from the page's top-left corner, y down) and pixels inside a pdf.js page view.
import type { PagePoint } from "../../index.js";
import { clamp } from "../elements/index.js";

/** The part of a pdf.js PageViewport the conversion needs; pdf.js handles scale and rotation in its two convert methods. */
export interface PageViewportLike {
  /** `[x0, y0, x1, y1]` in PDF user space, where y grows upwards from the bottom of the page. */
  viewBox: number[];
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/** The page point under a pixel position measured from the page element's top-left corner. */
export function pagePointAt(page: number, viewport: PageViewportLike, offsetX: number, offsetY: number): PagePoint {
  const [pdfX = 0, pdfY = 0] = viewport.convertToPdfPoint(offsetX, offsetY);
  const [left = 0, , , top = 0] = viewport.viewBox;
  return { page, x: pdfX - left, y: top - pdfY };
}

/** The pixel position, from the page element's top-left corner, of a point; a point beyond the page's edge lands on the edge. */
export function pixelOffsetOf(viewport: PageViewportLike, point: PagePoint): [number, number] {
  const [left = 0, bottom = 0, right = 0, top = 0] = viewport.viewBox;
  const x = clamp(point.x, 0, right - left);
  const y = clamp(point.y, 0, top - bottom);
  const [pixelX = 0, pixelY = 0] = viewport.convertToViewportPoint(left + x, top - y);
  return [pixelX, pixelY];
}
