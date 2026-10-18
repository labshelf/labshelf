// Loads the vendored pdf.js once per page and points it at the extension's own worker module.
import type * as Pdfjs from "pdfjs-dist";
import { bx } from "../platform";

export type PdfjsLib = typeof Pdfjs;

let pdfjs: Promise<PdfjsLib> | undefined;

// Needs a document with workers: the Firefox event page or the Chrome offscreen document, never a service worker.
export function loadPdfjs(): Promise<PdfjsLib> {
  pdfjs ??= (async () => {
    const lib = (await import(bx.runtime.getURL("vendor/pdfjs/build/pdf.min.mjs"))) as PdfjsLib;
    // PLATFORM: MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works.
    lib.GlobalWorkerOptions.workerPort = new Worker(bx.runtime.getURL("vendor/pdfjs/build/pdf.worker.min.mjs"), { type: "module" });
    return lib;
  })();
  return pdfjs;
}
