// Renders page 1 of a PDF to PNG in a worker thread so the TUI keeps responding (used without pdftoppm).
// Message in: { pdfPath, widthPx }. Message out: { png: Uint8Array } or { error: string }.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { createPdfjsLoader, loadNativeCanvas, nativeRenderOptions, renderPagePng } from "@labshelf/core/node";

const pdfjs = createPdfjsLoader();

async function render(pdfPath: string, widthPx: number): Promise<Uint8Array> {
  const canvasModule = loadNativeCanvas();
  if (!canvasModule) {
    throw new Error("@napi-rs/canvas could not be loaded, so PDFs cannot be rendered without poppler");
  }
  const task = await pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)), ...nativeRenderOptions(canvasModule) });
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
    return new Uint8Array(await renderPagePng(canvasModule, page, viewport));
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

const { pdfPath, widthPx } = workerData as { pdfPath: string; widthPx: number };
// TRAP: importing errorMessage from @labshelf/core here would bundle about 300 KB into the worker.
render(pdfPath, widthPx).then(
  (png) => parentPort?.postMessage({ png }, [png.buffer as ArrayBuffer]),
  (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
