// Runs the equation box mode: a drag over a page sends the box (page, PDF rect, text under it and a PNG) to the host to extract its LaTeX.
import { bytesToBase64 } from "../../encoding/base64.js";
import { MAX_EQUATION_PNG_BYTES } from "../protocol/messages.js";
import type { PageRect } from "../textBoxPlacement.js";
import { pageRectToPdfRegion, renderRegionPng, textInRegion, type PdfPageLike, type TextItemLike } from "./equationCrop.js";
import { showDraft } from "./noteBoxes.js";
import { beginPageDrag, trackPointer } from "./pageDrag.js";
import type { ReaderContext } from "./readerSession.js";

const MODE_CLASS = "rd-equation-mode";
/** A drag whose box is narrower or shorter than this many CSS pixels is taken for a stray click. */
const MIN_DRAG_PX = 8;
/** The PNG is rendered this many times wider than the box shows on screen. */
const WIDTH_FACTOR = 3;
/** Each retry of an oversized PNG renders this share of the pixels of the one before. */
const SHRINK_PIXELS = 0.5;
const MAX_SHRINKS = 4;
const DEFAULT_MAX_PIXELS = 4_000_000;

/** Where a box lies in the reader container's CSS pixels, measured from the container's top-left corner as it shows on screen. */
export interface BoxAnchor { left: number; top: number; width: number; height: number }

export class EquationTool {
  /** Called when the mode turns on or off, so the toolbar button can follow. */
  onChange: ((on: boolean) => void) | null = null;
  /** Called once a drag's box was sent to the host, with the request's id and where the box is, so the answer can open there. */
  onBox: ((requestId: string, anchor: BoxAnchor) => void) | null = null;
  private on = false;
  private available = false;
  private counter = 0;

  constructor(private readonly ctx: ReaderContext) {
    ctx.container.addEventListener("pointerdown", (e) => this.pointerDown(e), true);
  }

  get active(): boolean { return this.on; }

  /** Tells whether the host can extract equations; without it the mode cannot be on. */
  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) { this.setActive(false); }
  }

  setActive(on: boolean): void {
    const next = on && this.available;
    if (this.on === next) { return; }
    this.on = next;
    this.ctx.container.classList.toggle(MODE_CLASS, next);
    this.onChange?.(next);
  }

  toggle(): void { this.setActive(!this.on); }

  private pointerDown(down: PointerEvent): void {
    if (!this.on) { return; }
    const drag = beginPageDrag(down);
    if (!drag) { return; }
    const { page, pageNumber, frame, origin } = drag;
    const rectTo = (e: PointerEvent): PageRect => {
      const p = drag.at(e);
      return { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) };
    };
    trackPointer((e) => showDraft(page, rectTo(e)), (e) => {
      showDraft(page, null);
      const rect = rectTo(e);
      const box = new DOMRect(frame.left + rect.x * frame.width, frame.top + rect.y * frame.height, rect.w * frame.width, rect.h * frame.height);
      if (box.width < MIN_DRAG_PX || box.height < MIN_DRAG_PX) { return; }
      this.send(pageNumber, rect, box);
    });
  }

  private send(pageNumber: number, rect: PageRect, box: DOMRect): void {
    const requestId = `eq-${Date.now().toString(36)}-${++this.counter}`;
    const origin = this.ctx.container.getBoundingClientRect();
    const anchor: BoxAnchor = { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
    this.onBox?.(requestId, anchor);
    void this.extract(requestId, pageNumber, rect, box.width).catch((error: unknown) => {
      console.warn("LabShelf reader: the equation box could not be read", error);
    });
  }

  private async extract(requestId: string, pageNumber: number, rect: PageRect, cssWidth: number): Promise<void> {
    const page = await this.ctx.pdfDocument.getPage(pageNumber);
    const region = pageRectToPdfRegion(rect, page.getViewport({ scale: 1 }));
    const content = await page.getTextContent();
    const items: TextItemLike[] = [];
    for (const item of content.items) {
      if ("str" in item && "transform" in item) { items.push({ str: item.str, transform: item.transform, width: item.width, height: item.height }); }
    }
    const text = textInRegion(items, region);
    const pageLike = page as unknown as PdfPageLike;
    let maxPixels = DEFAULT_MAX_PIXELS;
    let png = await renderRegionPng(pageLike, region, { targetWidth: WIDTH_FACTOR * cssWidth, maxPixels });
    // The host refuses a larger PNG; a dense box is rendered again with fewer pixels until it fits.
    for (let tries = 0; png.length > MAX_EQUATION_PNG_BYTES && tries < MAX_SHRINKS; tries += 1) {
      maxPixels *= SHRINK_PIXELS;
      png = await renderRegionPng(pageLike, region, { targetWidth: WIDTH_FACTOR * cssWidth, maxPixels });
    }
    this.ctx.host.post({ command: "extractEquation", requestId, pageNumber, rect: region, text, png: bytesToBase64(png) });
  }
}
