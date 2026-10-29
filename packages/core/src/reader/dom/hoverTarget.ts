// Finds what the pointer hovers (text references and link destinations) and previews a link destination.
import type { PageViewport, RenderTask } from "pdfjs-dist";
import type { PdfRegion } from "../geometry.js";
import { findReferenceAtOffset, type InTextReference, findInTextReferences, joinLineParts, type JoinedLine, type LinePart } from "../inTextReferences.js";
import type { HoverAnchor, PdfDestination, PopupContent } from "./hoverPreview.js";
import { deriveDestPoint, deriveCropRectForPreview, type Rect } from "../index.js";
import type { CitationResolver } from "./textLayer.js";
import type { PreviewCitations } from "./citations.js";
import type { ReaderContext } from "./readerSession.js";
import { DOCUMENT_REPLACED } from "./pdfLoader.js";
import { renderElement } from "../../ui/dom/index.js";
import type { ThemeController } from "./theme.js";

/** Finds the reference under the pointer in plain text (scans, papers without link annotations) and describes it as a hover target. */

// OCR text is one run per word, and a reader points at the word, not at a character of it: on a run this short the
// whole box answers for the one reference it belongs to ("[1])," — the pointer may sit on the comma).
const WHOLE_RUN_MAX_CHARS = 14;

/**
 * @returns the text run the event is on, or null when it is not on a non-empty run of a text layer.
 */
export function runUnderPointer(e: MouseEvent): HTMLElement | null {
  const run = (e.target as Element).closest?.<HTMLElement>(TEXT_RUN_SELECTOR);
  if (!run || !run.closest(".textLayer") || !(run.textContent ?? "").trim()) { return null; }
  return run;
}

export class TextAnchors {
  /** Lines are rebuilt from geometry; pointer movement inside one run must not pay for that again. Spans are replaced when a page re-renders, which drops their entries. */
  private readonly lines = new WeakMap<HTMLElement, VisualLine>();

  targetAt(run: HTMLElement, clientX: number, clientY: number): HoverAnchor | null {
    const layer = run.closest<HTMLElement>(".textLayer");
    if (!layer) { return null; }
    const line = this.lineOf(layer, run);
    const index = line.spans.indexOf(run);
    if (index < 0 || line.refs.length === 0) { return null; }
    const runStart = line.joined.starts[index] ?? 0;
    const runEnd = runStart + (line.parts[index]?.text.length ?? 0);

    let ref: InTextReference | null = null;
    const caret = document.caretRangeFromPoint(clientX, clientY);
    if (caret && run.contains(caret.startContainer)) {
      // Characters of this run that precede the pointer (the run may hold nested find-highlight spans).
      const before = document.createRange();
      before.setStart(run, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      ref = findReferenceAtOffset(line.refs, runStart + before.toString().length);
    }
    if (!ref && runEnd - runStart <= WHOLE_RUN_MAX_CHARS) {
      const touching = line.refs.filter((r) => r.start < runEnd && r.end > runStart);
      if (touching.length === 1) { ref = touching[0]!; }
    }
    if (!ref) { return null; }

    const found = ref;
    const pieces: Array<{ span: HTMLElement; from: number; to: number }> = [];
    line.spans.forEach((span, i) => {
      const start = line.joined.starts[i] ?? 0;
      const length = line.parts[i]?.text.length ?? 0;
      if (start < found.end && start + length > found.start) {
        pieces.push({ span, from: Math.max(0, found.start - start), to: Math.min(length, found.end - start) });
      }
    });
    if (pieces.length === 0) { return null; }
    return { group: pieces.map((p) => p.span), ref: found, rect: () => deriveUnionRect(pieces.map((p) => deriveCharRangeRect(p.span, p.from, p.to))) };
  }

  private lineOf(layer: HTMLElement, run: HTMLElement): VisualLine {
    const cached = this.lines.get(run);
    if (cached && cached.spans.every((s) => s.isConnected)) { return cached; }
    const line = deriveVisualLine(layer, run);
    // Kept for this run only: membership is judged from the probed run's own height, so it is not symmetric.
    this.lines.set(run, line);
    return line;
  }
}

/** Measures pdf.js text runs: the visual line a run belongs to and the screen boxes of character ranges. */

const TEXT_RUN_SELECTOR = 'span[role="presentation"]';

interface VisualLine {
  spans: HTMLElement[];
  parts: LinePart[];
  joined: JoinedLine;
  refs: InTextReference[];
}

function deriveUnionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
}

/** Screen box of characters [from, to) of a run, which may hold nested find-highlight spans. */
function deriveCharRangeRect(run: HTMLElement, from: number, to: number): DOMRect {
  const range = document.createRange();
  const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && from <= seen + length) { range.setStart(node, Math.max(0, from - seen)); started = true; }
    if (started && to <= seen + length) { range.setEnd(node, Math.max(0, to - seen)); break; }
    seen += length;
  }
  const rect = started && !range.collapsed ? range.getBoundingClientRect() : null;
  return rect && rect.width > 0 ? rect : run.getBoundingClientRect();
}

/** A run of several characters that is taller than wide is set sideways. */
function isSideways(text: string, rect: DOMRect): boolean {
  return text.trim().length > 3 && rect.height > rect.width * 1.5;
}

/**
 * The text runs that share the hovered run's visual line, left to right. pdf.js positions every run absolutely, so the
 * line is recovered from geometry rather than from DOM order.
 */
function deriveVisualLine(layer: HTMLElement, run: HTMLElement): VisualLine {
  const ref = run.getBoundingClientRect();
  if (isSideways(run.textContent ?? "", ref)) {
    // Its box spans the page's height: every run of the page would count as sharing its "line".
    const parts: LinePart[] = [{ text: run.textContent ?? "", left: ref.left, right: ref.right, height: ref.height }];
    return { spans: [run], parts, joined: joinLineParts(parts), refs: [] };
  }
  const centre = ref.top + ref.height / 2;
  const tolerance = Math.max(ref.height, 4) * 0.6;
  const spans: HTMLElement[] = [];
  const rects = new Map<HTMLElement, DOMRect>();
  for (const el of layer.querySelectorAll<HTMLElement>(TEXT_RUN_SELECTOR)) {
    const text = (el.textContent ?? "").trim();
    if (!text) { continue; }
    const r = el.getBoundingClientRect();
    // A publisher's stamp up the margin would otherwise join whichever line crosses its middle.
    if (el !== run && isSideways(text, r)) { continue; }
    if (Math.abs(r.top + r.height / 2 - centre) <= tolerance) { spans.push(el); rects.set(el, r); }
  }
  spans.sort((a, b) => rects.get(a)!.left - rects.get(b)!.left);
  const parts = spans.map((el): LinePart => {
    const r = rects.get(el)!;
    return { text: el.textContent ?? "", left: r.left, right: r.right, height: r.height };
  });
  const joined = joinLineParts(parts);
  return { spans, parts, joined, refs: findInTextReferences(joined.text) };
}

/** Builds hover targets for PDF link annotations: finds the link under the pointer and prepares the popup for its destination. */

const LINK_SELECTOR = "section.linkAnnotation[data-internal-link]";

/**
 * @returns the internal link annotation the event is on, or null.
 */
export function findDestAnchor(e: MouseEvent): HTMLElement | null {
  return (e.target as Element).closest?.<HTMLElement>(LINK_SELECTOR) ?? null;
}

export function createDestHoverAnchor(link: HTMLElement): HoverAnchor {
  return { group: [link], ref: null, rect: () => link.getBoundingClientRect() };
}

export class DestContent {
  constructor(
    private readonly ctx: ReaderContext,
    private readonly resolver: CitationResolver,
    private readonly preview: DestPreview,
    private readonly citations: PreviewCitations,
  ) {}

  async prepare(link: HTMLElement, isCurrent: () => boolean): Promise<PopupContent | null> {
    const pageNumber = Number(link.closest<HTMLElement>(".page")?.dataset["pageNumber"]);
    const id = link.dataset["annotationId"];
    if (!pageNumber || !id) { return null; }
    const dest = (await this.citations.annotations.find(pageNumber, id))?.dest;
    if (!dest) { return null; }
    const card = await this.citations.linkCard(link);
    if (card) { return card; }
    const doc = this.ctx.pdfDocument;
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) { return null; }
    const ref = explicit[0] as unknown;
    const targetPage = ref && typeof ref === "object"
      ? (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1
      : typeof ref === "number" ? ref + 1 : 0;
    if (!targetPage || !isCurrent()) { return null; }
    const point = deriveDestPoint(explicit) ?? { x: null, y: null, kind: "Fit" };
    const jump = (): void => { void this.ctx.linkService.goToDestination(dest as PdfDestination); };

    if (point.y !== null && await this.resolver.isInReferences(targetPage, point.y, point.x)) {
      const text = await this.resolver.entryAt(targetPage, point.y, point.x);
      if (text) { return renderTextContent([text], jump); }
      // No reliable entry boundaries: a picture of the destination is never wrong, extracted text could be.
    }
    if (!isCurrent()) { return null; }
    const canvas = await this.preview.render(targetPage, point.x, point.y);
    return canvas ? { title: `Page ${targetPage}`, body: canvas, copyText: null, jump } : null;
  }
}

/**
 * Renders part of a page into a small canvas for the hover popup: the band around a link's destination, or an explicit
 * region such as a figure located from its caption.
 */

// Wide enough that a figure or a small table is readable without jumping to it; narrower panels shrink it to fit.
const PREVIEW_CSS_WIDTH = 560;
const PREVIEW_MARGIN = 32;
// Pages are rendered denser than the popup needs so that a single column of a two-column page (half the width) can
// still be shown at a useful size without going soft.
const OVERSAMPLE = 1.25;
// Hovering back and forth between a few links should not re-render; more than this is memory for nothing.
const PAGE_CACHE = 4;

function popupWidth(): number {
  return Math.max(240, Math.min(PREVIEW_CSS_WIDTH, window.innerWidth - PREVIEW_MARGIN));
}

interface RenderedPage {
  canvas: HTMLCanvasElement;
  viewport: PageViewport;
  dpr: number;
}

export class DestPreview {
  private readonly cache = new Map<number, RenderedPage>();
  private task: RenderTask | null = null;

  constructor(private readonly ctx: ReaderContext, private readonly theme: ThemeController) {
    theme.onPageColorsChange(() => this.cache.clear());
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.cache.clear());
  }

  /**
   * Cancels any in-flight page render.
   */
  cancel(): void {
    this.task?.cancel();
    this.task = null;
  }

  /**
   * @param pdfY destination y in PDF space, or null for "top of page".
   * @returns a canvas sized for the popup, or null when rendering was cancelled.
   */
  async render(pageNumber: number, pdfX: number | null, pdfY: number | null): Promise<HTMLCanvasElement | null> {
    const full = await this.fullPage(pageNumber);
    if (!full) { return null; }
    // convertToViewportPoint handles the page's rotation and the bottom-left PDF origin.
    const anchorY = pdfY === null ? null : (full.viewport.convertToViewportPoint(pdfX ?? 0, pdfY)[1] ?? null);
    return this.crop(full, deriveCropRectForPreview(anchorY, full.canvas.width, full.canvas.height), popupWidth());
  }

  /**
   * @param region rectangle in PDF user space, e.g. a figure plus its caption.
   * @returns a canvas sized for the popup, or null when rendering was cancelled.
   */
  async renderRegion(pageNumber: number, region: PdfRegion): Promise<HTMLCanvasElement | null> {
    const full = await this.fullPage(pageNumber);
    if (!full) { return null; }
    const [ax, ay] = full.viewport.convertToViewportPoint(region.x0, region.yTop);
    const [bx, by] = full.viewport.convertToViewportPoint(region.x1, region.yBottom);
    const x = Math.max(0, Math.min(ax ?? 0, bx ?? 0));
    const y = Math.max(0, Math.min(ay ?? 0, by ?? 0));
    const rect: Rect = {
      x,
      y,
      width: Math.max(1, Math.min(full.canvas.width - x, Math.abs((bx ?? 0) - (ax ?? 0)))),
      height: Math.max(1, Math.min(full.canvas.height - y, Math.abs((by ?? 0) - (ay ?? 0)))),
    };
    return this.crop(full, rect, Math.min(popupWidth(), Math.round(rect.width / full.dpr)));
  }

  private crop(full: RenderedPage, rect: Rect, cssWidth: number): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = Math.round(rect.width);
    out.height = Math.round(rect.height);
    out.style.width = `${cssWidth}px`;
    out.style.height = `${Math.round((rect.height / rect.width) * cssWidth)}px`;
    out.getContext("2d")?.drawImage(full.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
    return out;
  }

  private async fullPage(pageNumber: number): Promise<RenderedPage | null> {
    const cached = this.cache.get(pageNumber);
    if (cached) {
      // Refresh recency.
      this.cache.delete(pageNumber);
      this.cache.set(pageNumber, cached);
      return cached;
    }
    this.cancel();
    const page = await this.ctx.pdfDocument.getPage(pageNumber);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (PREVIEW_CSS_WIDTH * dpr * OVERSAMPLE) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const canvasContext = canvas.getContext("2d", { alpha: false });
    if (!canvasContext) { return null; }
    const pageColors = this.theme.pageColors;
    const task = page.render({
      canvas,
      canvasContext,
      viewport,
      ...(pageColors ? { pageColors } : {}),
    } as Parameters<typeof page.render>[0]);
    this.task = task;
    try {
      await task.promise;
    } catch {
      return null;
    } finally {
      if (this.task === task) { this.task = null; }
    }
    const rendered: RenderedPage = { canvas, viewport, dpr };
    this.cache.set(pageNumber, rendered);
    if (this.cache.size > PAGE_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) { this.cache.delete(oldest); }
    }
    return rendered;
  }
}

// Fills a popup with plain reference text.
export function renderTextContent(texts: string[], jump: () => void): PopupContent {
  return { title: "Reference", body: renderElement("div", { class: "rd-hover-text" }, ...texts.map((t) => renderElement("p", {}, t))), copyText: texts.join("\n\n"), jump };
}
