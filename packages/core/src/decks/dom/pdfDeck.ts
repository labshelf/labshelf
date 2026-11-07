// A LaTeX or Typst talk or poster shown from its built PDF: pdf.js loaded from host URLs, pages drawn on canvases, the slide source a
// presenter runs on (page notes and labels) and the poster content a poster preview measures (text below the print threshold).
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { renderElement } from "../../ui/dom/index.js";
import { smallTextThresholdPt } from "../posterMeasure.js";
import type { PosterContent, CanvasRect, SmallTextFlag } from "./openPosterPreview.js";
import type { PresenterSlideSource } from "./openPresenter.js";

export { mapPagesToSlides } from "../sourceDecks.js";

type PdfjsLib = typeof import("pdfjs-dist");

/** Where pdf.js and its data live for the page: module and worker URLs, and the optional cmap, font, wasm and ICC folders. */
export interface PdfDeckAssets { pdfjsUrl: string; workerUrl: string; cMapUrl?: string; stdFontUrl?: string; wasmUrl?: string; iccUrl?: string }

/** How a host gives the PDF: its bytes, and optionally its own worker (a browser extension page cannot start blob: workers). */
export interface PdfDeckSource { assets: PdfDeckAssets; readBytes(): Promise<ArrayBuffer>; createWorker?(workerUrl: string): Worker }

/** One text run of a page in PDF points from the page's top left, with its font size in points. */
export interface PdfTextRun { text: string; pt: number; left: number; top: number; width: number }

/** An opened PDF: page count and labels, each page's size in points, drawing a page on a canvas, and its text runs. */
export interface PdfDeck {
  count: number;
  labels: string[] | null;
  pageSize(page: number): { width: number; height: number };
  render(canvas: HTMLCanvasElement, page: number, scale: number): Promise<void>;
  textRuns(page: number): Promise<PdfTextRun[]>;
  destroy(): void;
}

/** One canvas's renders: the latest request's generation, the task drawing now and a promise that settles when it ends. */
interface CanvasRenders { generation: number; task: RenderTask | undefined; settled: Promise<void> }

const PX_PER_PT = 96 / 72;
const SLIDE_WIDTH = 1920;
const MAX_POSTER_PIXELS = 40_000_000;
const MAX_FLAGS = 300;

async function startWorker(pdfjs: PdfjsLib, source: PdfDeckSource): Promise<void> {
  if (source.createWorker) {
    pdfjs.GlobalWorkerOptions.workerPort = source.createWorker(source.assets.workerUrl);
    return;
  }
  // A webview URI cannot be a module worker directly, hence the Blob URL of the fetched source.
  const code = await (await fetch(source.assets.workerUrl)).text();
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })), { type: "module" });
}

/** pdf.js fetches cmaps, fonts, wasm and ICC profiles from the page, not its worker (a webview worker request never reaches the host). */
function documentParams(assets: PdfDeckAssets, data: ArrayBuffer): Record<string, unknown> {
  return {
    data, useWorkerFetch: false, cMapPacked: true, useSystemFonts: true, isEvalSupported: true,
    ...(assets.cMapUrl ? { cMapUrl: assets.cMapUrl } : {}),
    ...(assets.stdFontUrl ? { standardFontDataUrl: assets.stdFontUrl } : {}),
    ...(assets.wasmUrl ? { wasmUrl: assets.wasmUrl } : {}),
    ...(assets.iccUrl ? { iccUrl: assets.iccUrl } : {}),
  };
}

/** Draws one page onto the canvas, cancelling the canvas's earlier render; a newer request for the canvas makes an older one return untouched. */
async function renderPdfPage(doc: PDFDocumentProxy, renders: WeakMap<HTMLCanvasElement, CanvasRenders>, canvas: HTMLCanvasElement, page: number, scale: number): Promise<void> {
  const state = renders.get(canvas) ?? { generation: 0, task: undefined, settled: Promise.resolve() };
  renders.set(canvas, state);
  const generation = ++state.generation;
  state.task?.cancel();
  const pdfPage = await doc.getPage(Math.min(Math.max(page, 0), doc.numPages - 1) + 1);
  // Resizing a canvas clears it, so wait until the earlier task has settled; a newer request makes this one return untouched.
  await state.settled;
  if (generation !== state.generation) return;
  const viewport = pdfPage.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) return;
  const task = pdfPage.render({ canvasContext: context, viewport, canvas } as Parameters<typeof pdfPage.render>[0]);
  state.task = task;
  state.settled = task.promise.then(() => undefined, () => undefined);
  try {
    await task.promise;
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name !== "RenderingCancelledException") throw error;
  } finally {
    if (state.task === task) state.task = undefined;
  }
}

/** Loads pdf.js and the PDF, and reads every page's size and the page labels up front. */
export async function openPdfDeck(source: PdfDeckSource): Promise<PdfDeck> {
  const [pdfjs, data] = await Promise.all([import(/* @vite-ignore */ source.assets.pdfjsUrl) as Promise<PdfjsLib>, source.readBytes()]);
  await startWorker(pdfjs, source);
  const loading = pdfjs.getDocument(documentParams(source.assets, data));
  const doc: PDFDocumentProxy = await loading.promise;
  const sizes: Array<{ width: number; height: number }> = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const viewport = (await doc.getPage(n)).getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  const labels = await doc.getPageLabels().catch(() => null);
  const renders = new WeakMap<HTMLCanvasElement, CanvasRenders>();
  return {
    count: doc.numPages,
    labels,
    pageSize: (page) => sizes[page] ?? sizes[0] ?? { width: 720, height: 405 },
    render: (canvas, page, scale) => renderPdfPage(doc, renders, canvas, page, scale),
    textRuns: async (page) => {
      const pdfPage = await doc.getPage(page + 1);
      const height = pdfPage.getViewport({ scale: 1 }).height;
      const content = await pdfPage.getTextContent();
      return content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        const [, , c, d, e, f] = item.transform as number[];
        const pt = Math.hypot(c ?? 0, d ?? 0);
        return [{ text: item.str, pt, left: e ?? 0, top: height - (f ?? 0) - pt, width: item.width }];
      });
    },
    destroy: () => void loading.destroy(),
  };
}

/** A canvas showing one page, sized in CSS px and drawn at `pixelRatio` times that. */
function pageCanvas(box: HTMLElement, width: number, height: number): HTMLCanvasElement {
  const canvas = renderElement("canvas", { class: "ls-pdf-deck-page" });
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  box.append(canvas);
  return canvas;
}

const pixelRatio = (): number => Math.min(globalThis.devicePixelRatio || 1, 2);

/**
 * The presenter slide source of a PDF talk: one step per page (so overlays advance), notes and labels of the slide each page shows.
 * `slideOfPage` maps pages to source slides (mapPagesToSlides); without it pages are numbered alone and carry no notes.
 */
export function pdfSlideSource(pdf: PdfDeck, notes: readonly string[], slideOfPage: readonly number[] | null): PresenterSlideSource {
  const first = pdf.pageSize(0);
  const scale = SLIDE_WIDTH / first.width;
  const canvas = { width: SLIDE_WIDTH, height: Math.round(first.height * scale) };
  return {
    count: Math.max(1, pdf.count),
    canvas,
    notes: (page) => {
      const slide = slideOfPage?.[page];
      return slide === undefined ? "" : notes[slide] ?? "";
    },
    label: (page, count) => {
      const slide = slideOfPage?.[page];
      return slide === undefined ? `Page ${page + 1} of ${count}` : `Slide ${slide + 1} · page ${page + 1} of ${count}`;
    },
    mount: (box, page) => {
      const element = pageCanvas(box, canvas.width, canvas.height);
      const draw = (next: number): void => void pdf.render(element, next, scale * pixelRatio()).catch(() => undefined);
      draw(page);
      return { element, setSlide: draw, destroy: () => element.remove() };
    },
  };
}

/** The poster content of a one-page PDF poster: its first page at print size (96 px per inch), the text runs below the threshold flagged. */
export function pdfPosterContent(pdf: PdfDeck): PosterContent {
  const size = pdf.pageSize(0);
  const canvas = { width: Math.round(size.width * PX_PER_PT * 100) / 100, height: Math.round(size.height * PX_PER_PT * 100) / 100 };
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4 * 10) / 10;
  const thresholdPt = smallTextThresholdPt({ w: mm(size.width), h: mm(size.height), unit: "mm" });
  // A0 at 96 px per inch is about 14 million pixels; draw finer only while the bitmap stays within the budget.
  const detail = Math.min(2, Math.sqrt(MAX_POSTER_PIXELS / (canvas.width * canvas.height)));
  return {
    canvas,
    thresholdPt,
    mount: (canvasBox) => {
      const element = pageCanvas(canvasBox, canvas.width, canvas.height);
      const runs = pdf.textRuns(0).catch(() => [] as PdfTextRun[]);
      const ready = Promise.all([pdf.render(element, 0, PX_PER_PT * Math.max(detail, 0.5)), runs]).then(() => undefined);
      let found: PdfTextRun[] = [];
      void runs.then((all) => { found = all; });
      return {
        ready,
        smallText: (threshold): Array<SmallTextFlag & { rect: CanvasRect }> => found
          .map((run, leaf) => ({ run, leaf }))
          .filter(({ run }) => run.pt > 0 && run.pt < threshold)
          .slice(0, MAX_FLAGS)
          .map(({ run, leaf }) => ({
            block: "", leaf, pt: Math.round(run.pt * 10) / 10, text: run.text.trim(),
            rect: { left: run.left * PX_PER_PT, top: run.top * PX_PER_PT, width: run.width * PX_PER_PT, height: run.pt * PX_PER_PT },
          })),
        destroy: () => element.remove(),
      };
    },
  };
}
