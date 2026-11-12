// Recolours PDF pages for a theme while keeping figure hues, in place of pdf.js' luminance-only page colours.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createPageRecolor } from "../index.js";

// PLATFORM: pdf.js (6.3) sets every text and vector colour as a "#rrggbb" string on the 2D context's fillStyle and
// strokeStyle, and draws transparency groups and image masks on canvases from the document's CanvasFactory.
// A render whose pageColors carry `keepHue` is passed to pdf.js without pageColors (so it draws the PDF's own
// colours) and its canvas is marked; the context setters map colours only on marked canvases.

type Recolor = (colour: string) => string;

interface RenderParams {
  canvas?: HTMLCanvasElement | null;
  canvasContext?: CanvasRenderingContext2D | null;
  pageColors?: { background: string; foreground: string; keepHue?: boolean } | null;
}

type CanvasAndContext = { canvas: HTMLCanvasElement | null; context: CanvasRenderingContext2D | null };

const marks = new WeakMap<object, Recolor>();
const recolors = new Map<string, Recolor>();
const patchedPages = new WeakSet<object>();
let settersPatched = false;
/** The recolour of the context that last had a colour set; a canvas pdf.js creates mid-render belongs to that render. */
let lastRecolor: Recolor | null = null;

/**
 * Hooks the page recolouring into pdf.js once per page class: wraps `render` and the 2D context colour setters.
 * Must run before the first page renders.
 */
export async function installPageRecolor(pdfDocument: PDFDocumentProxy): Promise<void> {
  patchContextSetters();
  const page: object = await pdfDocument.getPage(1);
  const proto = Object.getPrototypeOf(page) as { render?: (params: RenderParams) => unknown } | null;
  if (!proto || patchedPages.has(proto) || typeof proto.render !== "function") { return; }
  patchedPages.add(proto);
  const render = proto.render;
  proto.render = function (this: unknown, params: RenderParams) {
    return render.call(this, prepareRender(params));
  };
}

/**
 * Marks or unmarks the render's canvas and strips pageColors for a hue-keeping theme.
 * @returns the params pdf.js should render with.
 */
export function prepareRender(params: RenderParams): RenderParams {
  const canvas = params.canvas ?? params.canvasContext?.canvas;
  const colors = params.pageColors;
  if (!colors?.keepHue) {
    if (canvas) { marks.delete(canvas); }
    return params;
  }
  if (canvas) { marks.set(canvas, findRecolor(colors.background, colors.foreground)); }
  return { ...params, pageColors: null };
}

function findRecolor(page: string, ink: string): Recolor {
  const key = `${page}|${ink}`;
  let recolor = recolors.get(key);
  if (!recolor) {
    recolor = createPageRecolor(page, ink);
    recolors.set(key, recolor);
  }
  return recolor;
}

function patchContextSetters(): void {
  if (settersPatched || typeof CanvasRenderingContext2D === "undefined") { return; }
  settersPatched = true;
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ["fillStyle", "strokeStyle"] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    const set = desc?.set;
    if (!desc || !set) { continue; }
    Object.defineProperty(proto, name, {
      ...desc,
      set(this: CanvasRenderingContext2D, value: unknown) {
        set.call(this, mapContextColour(this, value));
      },
    });
  }
}

/**
 * @returns the colour to set on `ctx`: recoloured when its canvas is marked, otherwise unchanged.
 */
export function mapContextColour(ctx: { canvas: object }, value: unknown): unknown {
  const recolor = marks.get(ctx.canvas) ?? null;
  lastRecolor = recolor;
  return recolor && typeof value === "string" ? recolor(value) : value;
}

/**
 * pdf.js' default DOM canvas factory, plus the mark of the render that asked for the canvas, given to pdf.js through
 * getDocument's `CanvasFactory` so groups and masks are recoloured like their page.
 */
export class RecolorCanvasFactory {
  private readonly ownerDocument: Document;
  private readonly enableHWA: boolean;

  constructor({ ownerDocument = globalThis.document, enableHWA = false }: { ownerDocument?: Document; enableHWA?: boolean }) {
    this.ownerDocument = ownerDocument;
    this.enableHWA = enableHWA;
  }

  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) { throw new Error("Invalid canvas size"); }
    const canvas = this.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    markLikeLast(canvas);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: !this.enableHWA }) };
  }

  reset(entry: CanvasAndContext, width: number, height: number): void {
    if (!entry.canvas) { throw new Error("Canvas is not specified"); }
    if (width <= 0 || height <= 0) { throw new Error("Invalid canvas size"); }
    entry.canvas.width = width;
    entry.canvas.height = height;
    markLikeLast(entry.canvas);
  }

  destroy(entry: CanvasAndContext): void {
    if (!entry.canvas) { throw new Error("Canvas is not specified"); }
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

function markLikeLast(canvas: HTMLCanvasElement): void {
  if (lastRecolor) { marks.set(canvas, lastRecolor); } else { marks.delete(canvas); }
}
