// The pdf.js files the extension ships and how its worker starts, shared by the reader page and the deck and source tabs.
import { bx } from "./bx";

/** The URL of a file of the pdf.js copy the extension ships. */
export const pdfjsAssetUrl = (path: string): string => bx.runtime.getURL(`vendor/pdfjs/${path}`);

/** pdf.js as the extension ships it; its worker is started from the extension's own URL, since MV3 pages may not start blob: workers. */
export function extensionPdfAssets() {
  const at = pdfjsAssetUrl;
  return { pdfjsUrl: at("build/pdf.min.mjs"), workerUrl: at("build/pdf.worker.min.mjs"), cMapUrl: at("cmaps/"), stdFontUrl: at("standard_fonts/"), wasmUrl: at("wasm/"), iccUrl: at("iccs/") };
}

// PLATFORM: MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works everywhere.
/** pdf.js's worker as a module worker, started from the extension's own URL. */
export const createPdfWorker = (url: string): Worker => new Worker(url, { type: "module" });
