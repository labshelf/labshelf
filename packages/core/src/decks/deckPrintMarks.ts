// Adds a mirrored-edge bleed, TrimBox and BleedBox and optional crop marks to every page of a PDF, for posters sent to a printer.
import { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";

export interface PrintMarksOptions { bleedMm: number; cropMarks: boolean }

export interface PosterPdfChoice { label: string; detail: string; marks: PrintMarksOptions | null }

/** The PDF choices a host offers before exporting a poster, in order. */
export const POSTER_PDF_CHOICES: readonly PosterPdfChoice[] = [
  { label: "PDF", detail: "Trim size, as built", marks: null },
  { label: "PDF with 3 mm bleed", detail: "For printers that trim", marks: { bleedMm: 3, cropMarks: false } },
  { label: "PDF with 3 mm bleed and crop marks", detail: "For printers that ask for marks", marks: { bleedMm: 3, cropMarks: true } },
];

const POINTS_PER_MM = 72 / 25.4;
const MAX_BLEED_MM = 20;
const MARK_OFFSET_MIN_MM = 3;
const MARK_LENGTH_MM = 5;
const MARK_WIDTH_PT = 0.25;

interface Rect { x: number; y: number; width: number; height: number }

/** A mirrored copy of the page clipped to one strip of the bleed area. */
interface BleedStrip { clip: Rect; x: number; y: number; xScale: number; yScale: number }

function bleedStrips(m: number, b: number, w: number, h: number): BleedStrip[] {
  // Reflection about the left edge x = m draws the page at x = m with xScale -1; about the right edge x = m + w, at x = m + 2w.
  const left = { x: m, xScale: -1 };
  const right = { x: m + 2 * w, xScale: -1 };
  const middleX = { x: m, xScale: 1 };
  const bottom = { y: m, yScale: -1 };
  const top = { y: m + 2 * h, yScale: -1 };
  const middleY = { y: m, yScale: 1 };
  return [
    { clip: { x: m - b, y: m, width: b, height: h }, ...left, ...middleY },
    { clip: { x: m + w, y: m, width: b, height: h }, ...right, ...middleY },
    { clip: { x: m, y: m - b, width: w, height: b }, ...middleX, ...bottom },
    { clip: { x: m, y: m + h, width: w, height: b }, ...middleX, ...top },
    { clip: { x: m - b, y: m - b, width: b, height: b }, ...left, ...bottom },
    { clip: { x: m + w, y: m - b, width: b, height: b }, ...right, ...bottom },
    { clip: { x: m - b, y: m + h, width: b, height: b }, ...left, ...top },
    { clip: { x: m + w, y: m + h, width: b, height: b }, ...right, ...top },
  ];
}

function drawBleed(page: PDFPage, embedded: PDFEmbeddedPage, m: number, b: number, w: number, h: number): void {
  for (const strip of bleedStrips(m, b, w, h)) {
    const { x, y, width, height } = strip.clip;
    page.pushOperators(pushGraphicsState(), rectangle(x, y, width, height), clip(), endPath());
    page.drawPage(embedded, { x: strip.x, y: strip.y, xScale: strip.xScale, yScale: strip.yScale });
    page.pushOperators(popGraphicsState());
  }
}

function drawCropMarks(page: PDFPage, m: number, offset: number, w: number, h: number): void {
  const length = MARK_LENGTH_MM * POINTS_PER_MM;
  const color = rgb(0, 0, 0);
  for (const [cx, sx] of [[m, -1], [m + w, 1]] as const) {
    for (const [cy, sy] of [[m, -1], [m + h, 1]] as const) {
      // One mark along the horizontal trim line and one along the vertical, both outside the bleed.
      page.drawLine({ start: { x: cx + sx * offset, y: cy }, end: { x: cx + sx * (offset + length), y: cy }, thickness: MARK_WIDTH_PT, color });
      page.drawLine({ start: { x: cx, y: cy + sy * offset }, end: { x: cx, y: cy + sy * (offset + length) }, thickness: MARK_WIDTH_PT, color });
    }
  }
}

/**
 * Puts every page of `pdf` on a larger page with a mirrored-edge bleed of `bleedMm`, TrimBox and BleedBox, and crop marks when asked.
 * @throws RangeError when bleedMm is not finite or outside 0..20.
 * @returns the input bytes unchanged for bleed 0 without crop marks; else deterministic bytes (no metadata, no dates).
 */
export async function addPrintMarks(pdf: Uint8Array, options: PrintMarksOptions): Promise<Uint8Array> {
  const { bleedMm, cropMarks } = options;
  if (!Number.isFinite(bleedMm) || bleedMm < 0 || bleedMm > MAX_BLEED_MM) {
    throw new RangeError(`The bleed must be between 0 and ${MAX_BLEED_MM} mm, got ${bleedMm}.`);
  }
  if (bleedMm === 0 && !cropMarks) return pdf;
  const b = bleedMm * POINTS_PER_MM;
  const markOffset = Math.max(b, MARK_OFFSET_MIN_MM * POINTS_PER_MM);
  const m = cropMarks ? markOffset + MARK_LENGTH_MM * POINTS_PER_MM : b;
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = source.getPages();
  const embedded = await out.embedPages(pages);
  for (const [index, page] of embedded.entries()) {
    const { width: w, height: h } = pages[index]?.getSize() ?? page.size();
    const sheet = out.addPage([w + 2 * m, h + 2 * m]);
    sheet.setMediaBox(0, 0, w + 2 * m, h + 2 * m);
    sheet.setCropBox(0, 0, w + 2 * m, h + 2 * m);
    sheet.setTrimBox(m, m, w, h);
    sheet.setBleedBox(m - b, m - b, w + 2 * b, h + 2 * b);
    if (b > 0) drawBleed(sheet, page, m, b, w, h);
    sheet.drawPage(page, { x: m, y: m });
    if (cropMarks) drawCropMarks(sheet, m, markOffset, w, h);
  }
  return out.save();
}
