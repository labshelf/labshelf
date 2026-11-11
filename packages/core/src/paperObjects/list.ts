// Lists a paper's numbered equations, figures and tables from its PDF text, with the box each one covers on its page.
import { deriveFloatRegion, type PdfRegion } from "../reader/geometry.js";
import { MAX_INDEXED_PAGES, analysePageText, readTextItems, type PageText } from "../reader/pageText.js";
import { findCaptionLines, type TextItemBox, type TextLine } from "../reader/textLines.js";
import type { PageBox, PaperObject } from "./types.js";

/** One PDF page's text items and size in PDF units (`getViewport({ scale: 1 })`). */
export interface PdfPageText {
  /** 1-based. */
  pageNumber: number;
  width: number;
  height: number;
  items: TextItemBox[];
}

/** The part of a pdf.js document `readPdfPages` reads. */
export interface PdfTextSource {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getViewport(options: { scale: 1 }): { width: number; height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

const DECIMALS = 10_000;

function round4(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a region in PDF space (origin bottom-left) to page fractions from the top-left, clamped to the page and
 * rounded to 4 decimals so that `x + w` and `y + h` stay within 1.
 */
export function regionToBox(region: PdfRegion, pageWidth: number, pageHeight: number): PageBox {
  const x = round4(clamp01(region.x0 / pageWidth));
  const y = round4(clamp01((pageHeight - region.yTop) / pageHeight));
  const right = round4(clamp01(region.x1 / pageWidth));
  const bottom = round4(clamp01((pageHeight - region.yBottom) / pageHeight));
  return { x, y, w: round4(Math.max(0, right - x)), h: round4(Math.max(0, bottom - y)) };
}

/** The inverse of `regionToBox`: page fractions from the top-left back to PDF space. */
export function boxToRegion(box: PageBox, pageWidth: number, pageHeight: number): PdfRegion {
  return {
    x0: box.x * pageWidth,
    x1: (box.x + box.w) * pageWidth,
    yTop: pageHeight - box.y * pageHeight,
    yBottom: pageHeight - (box.y + box.h) * pageHeight,
  };
}

/** @returns the lines whose baseline lies in the region and that overlap it horizontally, in reading order. */
export function deriveRegionLines(lines: readonly TextLine[], region: PdfRegion): TextLine[] {
  return lines.filter((l) => l.y >= region.yBottom && l.y <= region.yTop && l.xEnd > region.x0 && l.x < region.x1);
}

/** Reads the text of the first `maxPages` pages; a page whose text cannot be read is left out. */
export async function readPdfPages(doc: PdfTextSource, maxPages: number = MAX_INDEXED_PAGES): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  const last = Math.min(doc.numPages, maxPages);
  for (let pageNumber = 1; pageNumber <= last; pageNumber++) {
    try {
      const page = await doc.getPage(pageNumber);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ pageNumber, width, height, items: readTextItems(content.items) });
    } catch {
      // A page whose text cannot be extracted simply contributes no objects.
    }
  }
  return pages;
}

/** The reading-order lines of a page, as the reader builds them. */
export function analysePdfPage(page: PdfPageText): PageText {
  return analysePageText(page.items, page.width, page.height);
}

/**
 * Finds every captioned figure and table and every numbered display equation, as the reader's float previews do: the
 * first occurrence of a kind and label wins, so "Figure 3 (continued)" does not replace Figure 3.
 * @returns the objects in document order (page, then line), from at most the first 150 pages.
 */
export function listPaperObjects(pages: readonly PdfPageText[]): PaperObject[] {
  const out: PaperObject[] = [];
  const seen = new Set<string>();
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber).filter((p) => p.pageNumber <= MAX_INDEXED_PAGES);
  for (const page of ordered) {
    if (!(page.width > 0 && page.height > 0)) { continue; }
    const text = analysePdfPage(page);
    for (const hit of findCaptionLines(text.lines, text.width, text.columnSplit)) {
      const key = `${hit.kind}:${hit.label}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      const region = deriveFloatRegion(text.lines, hit, text.width, text.height, text.columnSplit);
      out.push({
        kind: hit.kind,
        label: hit.label,
        page: page.pageNumber,
        box: regionToBox(region, text.width, text.height),
        caption: text.lines[hit.lineIndex]!.text.trim(),
      });
    }
  }
  return out;
}
