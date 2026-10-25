// Renders the first sample PDF page as an 800-pixel-wide PNG using the extension's PDF.js worker.
import { loadPdfjs } from "../pdfText";

export async function renderTemplateThumbnail(pdf: Uint8Array): Promise<Uint8Array> {
  const task = (await loadPdfjs()).getDocument({ data: pdf.slice() });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 800 / page.getViewport({ scale: 1 }).width });
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "white" }).promise;
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob); else reject(new Error("Could not encode the template thumbnail"));
    }, "image/png"));
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    await task.destroy();
  }
}
