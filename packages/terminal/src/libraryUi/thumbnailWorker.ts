// Renders page 1 of a PDF to PNG in a worker thread so the TUI keeps responding (used without pdftoppm).
// Message in: { pdfPath, widthPx }. Message out: { png: Uint8Array } or { error: string }.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { renderFirstPagePng } from "@labshelf/core/node";

const { pdfPath, widthPx } = workerData as { pdfPath: string; widthPx: number };
// TRAP: importing errorMessage from @labshelf/core here would bundle about 300 KB into the worker.
readFile(pdfPath).then((bytes) => renderFirstPagePng(new Uint8Array(bytes), widthPx)).then(
  (png) => parentPort?.postMessage({ png }, [png.buffer as ArrayBuffer]),
  (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
