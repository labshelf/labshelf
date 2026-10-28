/** Draws PDF pages on the native Skia canvas in Node: the canvas loader, its getDocument options, PNG rendering and the document openers. */
import { createRequire } from "node:module";

import type { PdfDocumentLike, PdfOpener, PdfjsLoader } from "../pdf/index.js";
import { createPdfjsLoader, resolvePdfjsPackageJson } from "./pdfjs.js";

interface NativeCanvasContext {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

interface NativeCanvas {
  width: number;
  height: number;
  getContext(kind: "2d", options?: Record<string, unknown>): NativeCanvasContext;
  toBuffer(mime: "image/png"): Buffer;
}

export interface NativeCanvasModule {
  createCanvas(width: number, height: number): NativeCanvas;
}

const GEOMETRY_GLOBALS = ["Path2D", "DOMMatrix", "ImageData", "DOMPoint"];

let cached: NativeCanvasModule | null | undefined;

/**
 * pdf.js builds Path2D, DOMMatrix and ImageData from globals and hands them to the canvas context, which rejects any
 * implementation but its own, so the canvas's classes replace whatever the host defines.
 *
 * The copy pdfjs-dist itself depends on is preferred: two versions of the native Skia binding in one process exchange
 * incompatible objects and crash the host with a segmentation fault rather than an exception.
 * @returns the canvas module, or undefined when no native build is installed
 */
export function loadNativeCanvas(): NativeCanvasModule | undefined {
  if (cached === undefined) {
    cached = tryLoad();
  }
  return cached ?? undefined;
}

function tryLoad(): NativeCanvasModule | null {
  for (const requireCanvas of canvasRequirers()) {
    try {
      const loaded = requireCanvas("@napi-rs/canvas") as NativeCanvasModule & Record<string, unknown>;
      const globals = globalThis as Record<string, unknown>;
      for (const name of GEOMETRY_GLOBALS) {
        if (loaded[name]) {
          globals[name] = loaded[name];
        }
      }
      return loaded;
    } catch {
      // Not installed next to this resolution root; the next one may have it.
    }
  }
  return null;
}

function canvasRequirers(): Array<(id: string) => unknown> {
  const requirers: Array<(id: string) => unknown> = [];
  const pdfjsPackage = resolvePdfjsPackageJson();
  if (pdfjsPackage) {
    requirers.push(createRequire(pdfjsPackage));
  }
  if (typeof require === "function") {
    requirers.push(require);
  }
  return requirers;
}

/**
 * Hosts pdf.js does not recognise as Node would otherwise reach for document.createElement and FontFace.
 * @returns options to spread into getDocument
 */
export function createNativeCanvasOptions(canvas: NativeCanvasModule): Record<string, unknown> {
  return {
    CanvasFactory: canvasFactoryFor(canvas),
    FilterFactory: NoopFilterFactory,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    // Without a DOM there is no FontFace; glyphs are drawn as paths instead.
    disableFontFace: true,
    useSystemFonts: false,
  };
}

// Mirrors pdf.js' BaseFilterFactory: SVG filters need a DOM, so none are applied.
class NoopFilterFactory {
  addFilter(): string { return "none"; }
  addHCMFilter(): string { return "none"; }
  addAlphaFilter(): string { return "none"; }
  addLuminosityFilter(): string { return "none"; }
  addHighlightHCMFilter(): string { return "none"; }
  destroy(): void {}
}

interface CanvasAndContext {
  canvas: NativeCanvas | null;
  context: NativeCanvasContext | null;
}

// Mirrors pdf.js' BaseCanvasFactory over the given native canvas module.
function canvasFactoryFor(module: NativeCanvasModule): new (options?: Record<string, unknown>) => unknown {
  return class NativeCanvasFactory {
    create(width: number, height: number): CanvasAndContext {
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid canvas size");
      }
      const canvas = module.createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    }

    reset(target: CanvasAndContext, width: number, height: number): void {
      if (!target.canvas) {
        throw new Error("Canvas is not specified");
      }
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid canvas size");
      }
      target.canvas.width = width;
      target.canvas.height = height;
    }

    destroy(target: CanvasAndContext): void {
      if (!target.canvas) {
        throw new Error("Canvas is not specified");
      }
      target.canvas.width = target.canvas.height = 0;
      target.canvas = null;
      target.context = null;
    }
  };
}

// Rasterizes one pdf.js page to a PNG on the native canvas, on a white sheet.
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

// Opens PDF bytes with pdf.js on the native canvas, hands the document to a callback and tears the loading task down.
interface RenderPage extends RenderablePage {
  getViewport(options: { scale: number }): PdfViewport;
  cleanup(): void;
}

interface RenderDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<RenderPage>;
}

/**
 * @throws when no native canvas is installed, since nothing could be drawn
 */
export async function withPdfDocument<T>(
  pdfjs: PdfjsLoader,
  pdfBytes: Uint8Array,
  use: (document: RenderDocument, canvasModule: NativeCanvasModule) => Promise<T>,
): Promise<T> {
  const canvasModule = loadNativeCanvas();
  if (!canvasModule) { throw new Error("Cannot render PDF pages: the native canvas (@napi-rs/canvas) is not installed"); }
  // PLATFORM: pdf.js takes ownership of the buffer it is given, so the caller's bytes are copied to stay usable.
  const task = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), ...createNativeCanvasOptions(canvasModule) });
  try {
    return await use((await task.promise) as unknown as RenderDocument, canvasModule);
  } finally {
    // pdf.js 6 has no PDFDocumentProxy.destroy(); the loading task owns teardown.
    await task.destroy().catch(() => undefined);
  }
}

// Renders page 1 of a PDF to a PNG of a given pixel width.
const firstPageLoader = createPdfjsLoader();

/** @returns PNG bytes whose width is `widthPx`, on a white sheet */
export function renderFirstPagePng(pdfBytes: Uint8Array, widthPx: number): Promise<Uint8Array> {
  return withPdfDocument(firstPageLoader, pdfBytes, async (document, canvasModule) => {
    const page = await document.getPage(1);
    const scale = widthPx / page.getViewport({ scale: 1 }).width;
    return new Uint8Array(await renderPagePng(canvasModule, page, page.getViewport({ scale })));
  });
}

/** Opens PDFs by parsing them with pdf.js in the current Node process. */
export class NodePdfOpener implements PdfOpener {
  constructor(private readonly pdfjs: PdfjsLoader) {}

  async open(pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
    // pdf.js takes ownership of `data` and detaches the caller's buffer, which would leave importers with a
    // zero-length array to write to disk. It gets a private copy so the caller's bytes stay readable.
    const task = await this.pdfjs.getDocument({ data: new Uint8Array(pdfBytes) });
    const document = await task.promise;
    // pdf.js 6 dropped PDFDocumentProxy.destroy(); teardown belongs to the loading task, but core closes documents
    // through destroy().
    if (typeof (document as Partial<PdfDocumentLike>).destroy !== "function") {
      document.destroy = () => task.destroy();
    }
    return document;
  }
}
