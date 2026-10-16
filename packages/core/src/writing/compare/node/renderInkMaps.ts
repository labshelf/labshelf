/** Renders every page of a PDF file onto the native canvas and keeps only its ink. */
import { promises as fs } from "node:fs";

import type { PdfjsLoader } from "../../../import/index.js";
import { withPdfDocument } from "../../../import/node/index.js";
import { inkMapFromRgba, type InkMap } from "../inkMap.js";

/**
 * @param pixelsPerPoint render scale; 1.5 (108 dpi) separates text lines while keeping a page near a million pixels
 * @throws when no native canvas is installed, since nothing could be drawn
 */
export async function renderInkMaps(pdfjs: PdfjsLoader, pdfPath: string, pixelsPerPoint: number): Promise<InkMap[]> {
  const bytes = await fs.readFile(pdfPath);
  return withPdfDocument(pdfjs, bytes, async (document, canvasModule) => {
    const pages: InkMap[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: pixelsPerPoint });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = canvasModule.createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push(inkMapFromRgba(context.getImageData(0, 0, width, height).data, width, height));
      page.cleanup();
    }
    return pages;
  });
}
