// Renders page 1 of a PDF to a PNG of a given pixel width.
import { createPdfjsLoader } from "../loadPdfjs.js";
import { renderPagePng } from "./renderPagePng.js";
import { withPdfDocument } from "./withPdfDocument.js";

const pdfjs = createPdfjsLoader();

/** @returns PNG bytes whose width is `widthPx`, on a white sheet */
export function renderFirstPagePng(pdfBytes: Uint8Array, widthPx: number): Promise<Uint8Array> {
  return withPdfDocument(pdfjs, pdfBytes, async (document, canvasModule) => {
    const page = await document.getPage(1);
    const scale = widthPx / page.getViewport({ scale: 1 }).width;
    return new Uint8Array(await renderPagePng(canvasModule, page, page.getViewport({ scale })));
  });
}
