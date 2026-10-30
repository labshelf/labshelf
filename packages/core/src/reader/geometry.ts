// Computes the page regions hover previews show: float regions and destination crops.
import { deriveColumnBounds, type CaptionMatch, type TextLine } from "./textLines.js";

/** Computes the region to preview for a caption or equation label: the caption block plus the float it describes. */

/** Rectangle in PDF user space (origin bottom-left): yTop > yBottom. */
export interface PdfRegion {
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
}

const MAX_CAPTION_LINES = 6;
const MAX_FLOAT_RATIO = 0.55;
const MIN_FLOAT_RATIO = 0.08;
const TABLE_RATIO = 0.4;
const EQUATION_PAD_RATIO = 0.07;

interface FloatFrame {
  x0: number;
  x1: number;
  pageHeight: number;
  clampY: (y: number) => number;
}

function equationRegion(cap: TextLine, f: FloatFrame): PdfRegion {
  const pad = f.pageHeight * EQUATION_PAD_RATIO;
  return { x0: f.x0, x1: f.x1, yTop: f.clampY(cap.y + cap.height + pad), yBottom: f.clampY(cap.y - pad) };
}

// The caption block: its first line plus the lines that follow at normal line pitch.
function captionBlockEnd(lines: readonly TextLine[], hit: CaptionMatch): number {
  const cap = lines[hit.lineIndex]!;
  let last = hit.lineIndex;
  for (let i = hit.lineIndex + 1; i < lines.length && i - hit.lineIndex < MAX_CAPTION_LINES; i++) {
    const l = lines[i]!;
    const prev = lines[i - 1]!;
    if (l.column !== cap.column || prev.y - l.y > Math.max(prev.height, l.height) * 1.7 || prev.y - l.y <= 0) { break; }
    last = i;
  }
  return last;
}

function tableRegion(lines: readonly TextLine[], hit: CaptionMatch, f: FloatFrame): PdfRegion {
  const cap = lines[hit.lineIndex]!;
  const inColumn = (l: TextLine): boolean => l.xEnd > f.x0 + 2 && l.x < f.x1 - 2;
  const captionTop = cap.y + cap.height;
  // The body hangs below the caption. Follow its rows down and stop at the first clear break (the space before the
  // next paragraph, or the end of the text), so a table at the foot of a page is not shown above a void.
  // Rows are counted from the caption's first line: they follow it at ordinary line pitch, so the "caption block"
  // above would otherwise swallow the whole table.
  const floor = captionTop - f.pageHeight * TABLE_RATIO;
  const rows = lines
    .filter((l, i) => i !== hit.lineIndex && inColumn(l) && l.y < cap.y && l.y >= floor)
    .sort((p, q) => q.y - p.y);
  const gaps = rows.map((l, i) => (i === 0 ? cap.y : rows[i - 1]!.y) - l.y).filter((g) => g > 0).sort((p, q) => p - q);
  const typical = gaps[Math.floor((gaps.length - 1) / 2)] ?? 0;
  let bottom = cap.y - cap.height * 0.35;
  let previous = cap.y;
  for (const row of rows) {
    const gap = previous - row.y;
    if (typical > 0 && gap > typical * 2.8 && gap > f.pageHeight * 0.035) { break; }
    bottom = row.y - row.height * 1.8;
    previous = row.y;
  }
  // A caption with nothing recognisable under it (an image-only table in a scan): fall back to the fixed band.
  if (rows.length === 0) { bottom = floor; }
  return { x0: f.x0, x1: f.x1, yTop: f.clampY(captionTop + cap.height * 0.5), yBottom: f.clampY(Math.max(bottom, floor)) };
}

function figureRegion(lines: readonly TextLine[], hit: CaptionMatch, f: FloatFrame): PdfRegion {
  const { x0, x1, pageHeight, clampY } = f;
  const cap = lines[hit.lineIndex]!;
  const last = captionBlockEnd(lines, hit);
  const inColumn = (l: TextLine): boolean => l.xEnd > x0 + 2 && l.x < x1 - 2;
  // Small-font tick labels merged across panels can be page-wide; body text also has (about) the caption's font size.
  const isBodyText = (l: TextLine): boolean => (l.xEnd - l.x) >= (x1 - x0) * 0.3 && l.height >= cap.height * 0.75;
  const captionTop = cap.y + cap.height;
  const captionBottom = lines[last]!.y - lines[last]!.height * 0.35;

  let above = pageHeight - captionTop;
  let below = captionBottom;
  for (let i = 0; i < lines.length; i++) {
    if (i >= hit.lineIndex && i <= last) { continue; }
    const l = lines[i]!;
    if (!inColumn(l) || !isBodyText(l)) { continue; }
    if (l.y >= captionTop) { above = Math.min(above, l.y - captionTop); }
    else if (l.y + l.height <= captionBottom) { below = Math.min(below, captionBottom - (l.y + l.height)); }
  }
  const maxBand = pageHeight * MAX_FLOAT_RATIO;
  const figureAbove = above >= below;
  const band = Math.min(figureAbove ? above : below, maxBand);
  if (band < pageHeight * MIN_FLOAT_RATIO) {
    // No clear float next to the caption (dense page, OCR noise): show the caption with context on both sides.
    const pad = pageHeight * 0.22;
    return { x0, x1, yTop: clampY(captionTop + pad), yBottom: clampY(captionBottom - pad) };
  }
  return figureAbove
    ? { x0, x1, yTop: clampY(captionTop + band), yBottom: clampY(captionBottom) }
    : { x0, x1, yTop: clampY(captionTop + cap.height * 0.4), yBottom: clampY(captionBottom - band) };
}

/**
 * Region to preview for a caption: the caption block plus the float it describes.
 * Tables sit below their caption by convention. A figure sits on whichever side of its caption has the larger band free
 * of body text (journals caption below the figure, ABNT theses above it); narrow lines inside that band are axis labels
 * and legends OCR picked up from the figure itself, so they do not end the band.
 * @returns the region in PDF user space, clamped to the page.
 */
export function deriveFloatRegion(
  lines: readonly TextLine[],
  hit: CaptionMatch,
  pageWidth: number,
  pageHeight: number,
  columnSplit: number | null,
): PdfRegion {
  const cap = lines[hit.lineIndex]!;
  const [x0, x1] = deriveColumnBounds(cap, pageWidth, columnSplit);
  const frame: FloatFrame = { x0, x1, pageHeight, clampY: (y) => Math.min(pageHeight, Math.max(0, y)) };
  if (hit.kind === "equation") { return equationRegion(cap, frame); }
  if (hit.kind === "table") { return tableRegion(lines, hit, frame); }
  return figureRegion(lines, hit, frame);
}

// Parses pdf.js explicit destinations and computes the crop rectangle for hover previews.

export interface PdfDestinationSpec {
  /** PDF user-space coordinates (origin bottom-left); null when the destination does not pin that axis. */
  x: number | null;
  y: number | null;
  kind: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Reads the target point out of an explicit destination array `[pageRef, {name}, ...args]`.
 * @returns the point, or null when `dest` is not a well-formed explicit destination.
 */
export function deriveDestPoint(dest: unknown): PdfDestinationSpec | null {
  if (!Array.isArray(dest) || dest.length < 2) { return null; }
  const mode = dest[1] as { name?: unknown } | null;
  const kind = mode && typeof mode === "object" && typeof mode.name === "string" ? mode.name : null;
  if (!kind) { return null; }
  switch (kind) {
    case "XYZ":
      return { kind, x: num(dest[2]), y: num(dest[3]) };
    case "FitH":
    case "FitBH":
      return { kind, x: null, y: num(dest[2]) };
    case "FitV":
    case "FitBV":
      return { kind, x: num(dest[2]), y: null };
    case "FitR":
      // [left, bottom, right, top]
      return { kind, x: num(dest[2]), y: num(dest[5]) };
    case "Fit":
    case "FitB":
      return { kind, x: null, y: null };
    default:
      return null;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOptions {
  /** Fraction of the page height shown in the popup. */
  heightRatio?: number;
  /** Context kept above the anchor so a figure caption or heading is not cut at its first line. */
  leadRatio?: number;
}

/**
 * Crop window, in viewport pixels (origin top-left), around a destination's y. Full page width: figures, tables and equations span it unpredictably.
 * @returns a rect clamped inside the page.
 */
export function deriveCropRectForPreview(
  anchorY: number | null,
  pageWidth: number,
  pageHeight: number,
  opts: CropOptions = {},
): Rect {
  const heightRatio = opts.heightRatio ?? 0.38;
  const leadRatio = opts.leadRatio ?? 0.04;
  const height = Math.min(pageHeight, Math.max(1, pageHeight * heightRatio));
  const wanted = anchorY === null ? 0 : anchorY - pageHeight * leadRatio;
  const y = Math.min(Math.max(0, wanted), Math.max(0, pageHeight - height));
  return { x: 0, y, width: pageWidth, height };
}
