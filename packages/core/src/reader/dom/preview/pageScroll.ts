// Scrolls the PDF so a page area sits a little below the top of the view.
import { clampPage, type PageArea } from "../../index.js";
import type { ReaderContext } from "../session/index.js";

// PDF points of page kept visible above the area, so the lines before a problem show with it.
const LEAD_IN = 48;

interface PageViewLike {
  viewport?: { viewBox: number[] };
}

/** @returns a function that scrolls to an area given in points from the page's top-left corner. */
export function areaScroller(ctx: ReaderContext): (area: PageArea) => void {
  return (area) => {
    const { pdfViewer, pdfDocument } = ctx;
    const pageNumber = clampPage(area.page, pdfDocument.numPages);
    const viewBox = (pdfViewer.getPageView(pageNumber - 1) as PageViewLike | undefined)?.viewport?.viewBox;
    if (!viewBox) { pdfViewer.scrollPageIntoView({ pageNumber }); return; }
    // PDF user space grows upwards from the box's bottom; the area's `top` counts down from the box's top.
    const top = (viewBox[3] ?? 0) - Math.max(0, area.top - LEAD_IN);
    pdfViewer.scrollPageIntoView({ pageNumber, destArray: [null, { name: "XYZ" }, null, top, null], allowNegativeOffset: true });
  };
}
