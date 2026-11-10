// Turns a box dragged on a page into what the equation reader needs: its PDF region, the text inside it and an un-themed PNG of it.
import type { PdfRegion } from "../geometry.js";
import type { PageRect } from "../textBoxPlacement.js";

/** The part of a pdf.js PageViewport the conversions use. */
export interface PageViewportLike {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/** A pdf.js text item: the baseline origin is at transform[4], transform[5]. */
export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** The part of a pdf.js page the render uses. */
export interface PdfPageLike {
  getViewport(params: { scale: number; offsetX?: number; offsetY?: number }): PageViewportLike;
  render(params: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PageViewportLike }): { promise: Promise<unknown> };
}

/** The box's rendered width is this many times its on-screen width, so a glyph keeps its detail for the reader of the PNG. */
const WIDTH_FACTOR = 3;
const MIN_WIDTH_PX = 600;
const MAX_PIXELS = 4_000_000;
/** Share of an item's width and height that must lie inside the region for the item to count as in it. */
const MIN_OVERLAP = 0.5;
/** Two items whose baselines differ by less than this share of the taller one's height are on one line. */
const SAME_LINE = 0.5;

/**
 * @param rect the box in page fractions (0..1, origin top-left) of the page as the viewport shows it.
 * @returns the box in PDF user space; the viewport's conversion carries the page's rotation.
 */
export function pageRectToPdfRegion(rect: PageRect, viewport: PageViewportLike): PdfRegion {
  const [ax = 0, ay = 0] = viewport.convertToPdfPoint(rect.x * viewport.width, rect.y * viewport.height);
  const [bx = 0, by = 0] = viewport.convertToPdfPoint((rect.x + rect.w) * viewport.width, (rect.y + rect.h) * viewport.height);
  return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), yTop: Math.max(ay, by), yBottom: Math.min(ay, by) };
}

interface PlacedItem { str: string; x: number; y: number }

/**
 * @returns the text of the items lying inside the region, top to bottom then left to right, joined by spaces.
 * An item counts when half or more of its width and of its height is inside.
 */
export function textInRegion(items: TextItemLike[], region: PdfRegion): string {
  const picked: Array<PlacedItem & { height: number }> = [];
  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const height = item.height || Math.abs(item.transform[3] ?? 0) || 10;
    if (item.str.trim() === "") { continue; }
    if (!overlapsEnough(x, x + item.width, region.x0, region.x1) || !overlapsEnough(y, y + height, region.yBottom, region.yTop)) { continue; }
    picked.push({ str: item.str, x, y, height });
  }
  picked.sort((a, b) => b.y - a.y);
  const lines: Array<{ y: number; height: number; items: PlacedItem[] }> = [];
  for (const item of picked) {
    const line = lines.find((l) => Math.abs(l.y - item.y) < SAME_LINE * Math.max(l.height, item.height));
    if (line) { line.items.push(item); } else { lines.push({ y: item.y, height: item.height, items: [item] }); }
  }
  return lines.flatMap((line) => line.items.sort((a, b) => a.x - b.x)).map((item) => item.str.trim()).join(" ");
}

/** True when at least MIN_OVERLAP of the span [from, to] lies inside [low, high]; an empty span counts when it lies inside. */
function overlapsEnough(from: number, to: number, low: number, high: number): boolean {
  const length = to - from;
  if (length <= 0) { return from >= low && from <= high; }
  const inside = Math.min(to, high) - Math.max(from, low);
  return inside / length >= MIN_OVERLAP - 1e-9;
}

/**
 * Renders only the region of the page, black on white (no page colours), as a PNG.
 * @param options.targetWidth the PNG's width in pixels; defaults to 3x the box's width at 100% zoom; never below 600.
 * @param options.maxPixels the most pixels the canvas may have; 4 million by default, the aspect ratio kept.
 */
export async function renderRegionPng(page: PdfPageLike, region: PdfRegion, options: { targetWidth?: number; maxPixels?: number } = {}): Promise<Uint8Array> {
  const base = page.getViewport({ scale: 1 });
  const [ax = 0, ay = 0] = base.convertToViewportPoint(region.x0, region.yTop);
  const [bx = 0, by = 0] = base.convertToViewportPoint(region.x1, region.yBottom);
  const left = Math.min(ax, bx);
  const top = Math.min(ay, by);
  const boxWidth = Math.max(1, Math.abs(bx - ax));
  const boxHeight = Math.max(1, Math.abs(by - ay));
  let width = Math.max(MIN_WIDTH_PX, options.targetWidth ?? WIDTH_FACTOR * boxWidth);
  let height = width * boxHeight / boxWidth;
  const maxPixels = options.maxPixels ?? MAX_PIXELS;
  if (width * height > maxPixels) {
    const shrink = Math.sqrt(maxPixels / (width * height));
    width = Math.floor(width * shrink);
    height = Math.floor(height * shrink);
  } else {
    width = Math.round(width);
    height = Math.round(height);
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  const scale = width / boxWidth;
  // The offsets slide the region's top-left corner onto the canvas origin; pdf.js crops the rest away.
  const viewport = page.getViewport({ scale, offsetX: -left * scale, offsetY: -top * scale });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const canvasContext = canvas.getContext("2d", { alpha: false });
  if (!canvasContext) { throw new Error("The equation box could not be drawn: no canvas context."); }
  canvasContext.fillStyle = "#fff";
  canvasContext.fillRect(0, 0, width, height);
  await page.render({ canvas, canvasContext, viewport }).promise;
  return canvasPng(canvas);
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) { return new Uint8Array(await blob.arrayBuffer()); }
  const url = canvas.toDataURL("image/png");
  const binary = atob(url.slice(url.indexOf(",") + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
