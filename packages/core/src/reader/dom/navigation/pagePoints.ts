// Converts between the host's page points (points from the page's top-left corner, y down) and pixels inside a pdf.js page view.
import type { PageViewport } from "pdfjs-dist";

import type { PagePoint } from "../../index.js";
import { deriveClampedNumber } from "../elements/index.js";

/** The part of a pdf.js PageViewport the conversion needs; pdf.js handles scale and rotation in its two convert methods. */
export type PageViewportLike = Pick<PageViewport, "viewBox" | "convertToPdfPoint" | "convertToViewportPoint">;

/** The part of a pdf.js page view that marks drawn over a page need. */
export interface PageViewLike {
  div: HTMLElement;
  viewport: PageViewportLike & Pick<PageViewport, "width" | "height">;
}

/** The page point under a pixel position measured from the page element's top-left corner. */
export function derivePagePoint(page: number, viewport: PageViewportLike, offsetX: number, offsetY: number): PagePoint {
  const [pdfX = 0, pdfY = 0] = viewport.convertToPdfPoint(offsetX, offsetY);
  const [left = 0, , , top = 0] = viewport.viewBox;
  return { page, x: pdfX - left, y: top - pdfY };
}

/** The pixel position, from the page element's top-left corner, of a point; a point beyond the page's edge lands on the edge. */
export function derivePixelOffset(viewport: PageViewportLike, point: PagePoint): [number, number] {
  const [left = 0, bottom = 0, right = 0, top = 0] = viewport.viewBox;
  const x = deriveClampedNumber(point.x, 0, right - left);
  const y = deriveClampedNumber(point.y, 0, top - bottom);
  const [pixelX = 0, pixelY = 0] = viewport.convertToViewportPoint(left + x, top - y);
  return [pixelX, pixelY];
}
