// Opens a paper's PDF with pdf.js in Node and renders a region of a page as a PNG on the native canvas, for the "From paper…" port.
import type { PdfjsLoader } from "../../import/pdf/index.js";
import { createNativeCanvasOptions, drawPageOnWhite, loadNativeCanvas, type NativeCanvasModule, type RenderablePage } from "../../import/node/nativeCanvas.js";
import type { OpenPaperPdf } from "../library.js";
import type { PdfTextSource } from "../list.js";
import type { PageBox } from "../types.js";

/** The crop is this many times the box's width at 100% zoom, so an inserted image stays sharp; never narrower than MIN_WIDTH. */
const SCALE = 3;
const MIN_WIDTH = 600;
const MAX_PIXELS = 4_000_000;

interface NodePdfViewport { width: number; height: number }

interface NodePdfPage extends RenderablePage {
  getViewport(options: { scale: number; offsetX?: number; offsetY?: number }): NodePdfViewport;
}

/** A pdf.js document opened on the native canvas: its text for the object list, its pages for the crops. */
export interface NodePaperDocument extends PdfTextSource {
  getPage(pageNumber: number): Promise<NodePdfPage & { getTextContent(): Promise<{ items: unknown[] }> }>;
}

export interface NodePaperPdf {
  open(bytes: Uint8Array): Promise<OpenPaperPdf<NodePaperDocument>>;
  renderRegion(doc: NodePaperDocument, page: number, box: PageBox): Promise<Uint8Array>;
}

/** The pixel size of a crop of `boxWidth` x `boxHeight` page points: SCALE times, at least MIN_WIDTH wide, at most MAX_PIXELS. */
export function cropSize(boxWidth: number, boxHeight: number): { width: number; height: number } {
  const wide = Math.max(MIN_WIDTH, SCALE * boxWidth);
  const shrink = Math.min(1, Math.sqrt(MAX_PIXELS / (wide * wide * boxHeight / boxWidth)));
  return { width: Math.max(1, Math.floor(wide * shrink)), height: Math.max(1, Math.floor(wide * shrink * boxHeight / boxWidth)) };
}

/**
 * PDFs opened with `pdfjs` on the native Skia canvas; the crops are black on white.
 * @throws from open and renderRegion when no native canvas is installed
 */
export function createNodePaperPdf(pdfjs: PdfjsLoader, loadCanvas: () => NativeCanvasModule | undefined = loadNativeCanvas): NodePaperPdf {
  const canvasModule = (): NativeCanvasModule => {
    const loaded = loadCanvas();
    if (!loaded) { throw new Error("Cannot render PDF pages: the native canvas (@napi-rs/canvas) is not installed"); }
    return loaded;
  };
  return {
    async open(bytes) {
      // PLATFORM: pdf.js takes ownership of the buffer it is given, so the caller's bytes are copied.
      const task = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...createNativeCanvasOptions(canvasModule()) });
      try {
        return { doc: (await task.promise) as unknown as NodePaperDocument, close: () => task.destroy() };
      } catch (error) {
        await task.destroy().catch(() => undefined);
        throw error;
      }
    },
    async renderRegion(doc, pageNumber, box) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const { width, height } = cropSize(Math.max(1, box.w * base.width), Math.max(1, box.h * base.height));
      const scale = width / Math.max(1, box.w * base.width);
      // The offsets slide the box's top-left corner onto the canvas origin; pdf.js crops the rest away.
      const viewport = page.getViewport({ scale, offsetX: -box.x * base.width * scale, offsetY: -box.y * base.height * scale });
      const canvas = await drawPageOnWhite(canvasModule(), page, viewport, { width, height });
      return new Uint8Array(canvas.toBuffer("image/png"));
    },
  };
}
