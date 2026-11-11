// Turns one PDF page's pdf.js text items into the reading-order lines every text-based page analysis shares.
import { detectColumns, deriveLinesFromItems, deriveReadableItems, runOrientation, type TextItemBox, type TextLine } from "./textLines.js";

/** A page's text lines in reading order, its column split and its size in PDF units. */
export interface PageText {
  lines: TextLine[];
  columnSplit: number | null;
  width: number;
  height: number;
}

// A monograph has thousands of lines; past this an index of its captions costs more than it is worth.
export const MAX_INDEXED_PAGES = 150;

/**
 * Reduces pdf.js text content items to geometry; items without a string or a transform (marked content) are skipped.
 * @returns the items in their original order.
 */
export function readTextItems(items: readonly unknown[]): TextItemBox[] {
  const out: TextItemBox[] = [];
  for (const raw of items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (typeof it.str !== "string" || !it.transform) { continue; }
    out.push({
      str: it.str,
      x: it.transform[4] ?? 0,
      y: it.transform[5] ?? 0,
      width: it.width ?? 0,
      height: it.height || Math.abs(it.transform[3] ?? 0) || 10,
      orientation: runOrientation(it.transform),
    });
  }
  return out;
}

/** @returns the page's readable lines and column split, as the reader resolves citations and floats on them. */
export function analysePageText(items: readonly TextItemBox[], width: number, height: number): PageText {
  const readable = deriveReadableItems(items, width);
  return { lines: deriveLinesFromItems(readable, width), columnSplit: detectColumns(readable, width), width, height };
}
