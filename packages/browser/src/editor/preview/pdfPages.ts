// Renders PDF bytes as page canvases with the pdf.js the extension vendors, swapping them in only once every page is drawn.
import type * as Pdfjs from "pdfjs-dist";

const PDFJS = new URL("../vendor/pdfjs/build/", location.href);

let pdfjs: Promise<typeof Pdfjs> | undefined;

function loadPdfjs(): Promise<typeof Pdfjs> {
  pdfjs ??= (import(/* webpackIgnore: true */ new URL("pdf.min.mjs", PDFJS).href) as Promise<typeof Pdfjs>).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", PDFJS).href;
    return lib;
  });
  return pdfjs;
}

/** Draws every page at the container's width; the previous pages stay visible until the new ones are ready. */
export async function renderPdfPages(container: HTMLElement, bytes: Uint8Array): Promise<void> {
  const lib = await loadPdfjs();
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = lib.getDocument({ data: bytes.slice() });
  try {
    const document = await task.promise;
    const width = Math.max(container.clientWidth - 16, 200);
    const ratio = globalThis.devicePixelRatio || 1;
    const canvases: HTMLCanvasElement[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.setAttribute("aria-label", `Page ${number}`);
      await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      canvases.push(canvas);
    }
    container.replaceChildren(...canvases);
  } finally {
    await task.destroy();
  }
}
