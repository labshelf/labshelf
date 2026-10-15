// Renders page 1 of a PDF to PNG in a worker thread so the TUI keeps responding (used without pdftoppm).
// Message in: { pdfPath, widthPx }. Message out: { png: Uint8Array } or { error: string }.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { createPdfjsLoader, loadNativeCanvas } from "@labshelf/core/node";

const pdfjs = createPdfjsLoader();

async function render(pdfPath: string, widthPx: number): Promise<Uint8Array> {
  const canvasModule = loadNativeCanvas();
  if (!canvasModule) {
    throw new Error("@napi-rs/canvas could not be loaded, so PDFs cannot be rendered without poppler");
  }
  const task = await pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)) });
  try {
    const document = (await task.promise) as unknown as {
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: Record<string, unknown>): { promise: Promise<void> };
      }>;
    };
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: widthPx / base.width });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return new Uint8Array(canvas.toBuffer("image/png"));
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

const { pdfPath, widthPx } = workerData as { pdfPath: string; widthPx: number };
render(pdfPath, widthPx).then(
  (png) => parentPort?.postMessage({ png }, [png.buffer as ArrayBuffer]),
  (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
