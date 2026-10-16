// Reads the first page of a PDF as text, one line per line of the page, with the vendored pdf.js.
import type * as Pdfjs from "pdfjs-dist";
import { bx } from "../platform";

type PdfjsLib = typeof Pdfjs;

let pdfjs: Promise<PdfjsLib> | undefined;

// Needs a document with workers: the Firefox event page or the Chrome offscreen document, never a service worker.
function loadPdfjs(): Promise<PdfjsLib> {
  pdfjs ??= (async () => {
    const lib = (await import(bx.runtime.getURL("vendor/pdfjs/build/pdf.min.mjs"))) as PdfjsLib;
    // PLATFORM: MV3 pages may not start blob: workers (Firefox refuses them); the extension's own module URL works.
    lib.GlobalWorkerOptions.workerPort = new Worker(bx.runtime.getURL("vendor/pdfjs/build/pdf.worker.min.mjs"), { type: "module" });
    return lib;
  })();
  return pdfjs;
}

/** @returns the text of page 1 with a newline wherever pdf.js ends a line */
export async function firstPageText(bytes: Uint8Array): Promise<string> {
  const lib = await loadPdfjs();
  // pdf.js transfers the buffer to its worker; a private copy keeps the caller's bytes readable.
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
  try {
    const page = await (await task.promise).getPage(1);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.hasEOL ? `${item.str}\n` : item.str;
    }
    return text;
  } finally {
    await task.destroy();
  }
}
