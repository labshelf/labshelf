// Rasterizes one pdf.js page to a PNG on the native canvas, on a white sheet.
import type { NativeCanvasModule } from "./nativeCanvas.js";

export interface PdfViewport {
  width: number;
  height: number;
}

export interface RenderablePage {
  render(options: Record<string, unknown>): { promise: Promise<void> };
}

/** PDF pages assume a white sheet; without the fill transparent areas turn black in PNG viewers and OCR. */
export async function renderPagePng(canvasModule: NativeCanvasModule, page: RenderablePage, viewport: PdfViewport): Promise<Buffer> {
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toBuffer("image/png");
}
