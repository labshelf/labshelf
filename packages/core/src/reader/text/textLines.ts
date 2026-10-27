// Rebuilds text lines from pdf.js items and locates captions on them.
import { FIGURE_WORD, FLOAT_LABEL, deriveFloatKind, type FloatKind } from "./inTextReferences.js";

// Rebuilds reading-order text lines from pdf.js text items, aware of two-column layouts, sideways margin stamps and
// the OCR debris they leave behind.

/** A pdf.js TextItem reduced to geometry: x/y are `transform[4]`/`transform[5]` (PDF space, origin bottom-left). */
export interface TextItemBox {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Quarter turn the run is set at, from `runOrientation`; absent means upright. */
  orientation?: number;
}

export interface TextLine {
  text: string;
  x: number;
  xEnd: number;
  /** Baseline, PDF space. */
  y: number;
  height: number;
  /** 0 for single-column pages and the left column; 1 for the right column. */
  column: number;
}

const BINS = 100;

/**
 * @param transform pdf.js text transform `[a, b, c, d, e, f]`.
 * @returns the quarter turn a run is set at: 0 upright, 1 reading bottom-to-top, 2 upside down, 3 reading top-to-bottom.
 */
export function runOrientation(transform: readonly number[]): number {
  const a = transform[0] ?? 1;
  const b = transform[1] ?? 0;
  if (Math.abs(a) >= Math.abs(b)) { return a >= 0 ? 0 : 2; }
  return b > 0 ? 1 : 3;
}

const MIN_WORDS_FOR_MARGINS = 20;
const DEBRIS_MAX_CHARS = 3;
// "[1]", "(12)", "3.", "a)": hanging list and reference markers legitimately sit left of the text block.
const MARKER_SHAPED = /^(?:[[(]\s*[\p{L}\d]{1,3}\s*[\])]?|[\p{L}\d]{1,3}[.)\]])$/u;

/**
 * Removes what is on the page but not part of its running text, before lines are rebuilt:
 *  - runs set sideways, such as the "Downloaded from … subject to license" stamp publishers print up the margin. Read
 *    as horizontal they are hundreds of points wide and swallow whichever line shares their y. The page's dominant
 *    orientation is kept, so a page drawn entirely sideways still yields its text;
 *  - the debris OCR makes of such a stamp: one- to three-character tokens ("&", "5", "[=") stranded in the outer
 *    margin. Glued to the start of each line they defeat every line-anchored test downstream — "& REFERENCES" is not
 *    a heading, "5 [1] A. Author" not a numbered entry, "p FIG. 1. An example" not a caption.
 * @returns the items that belong to the page's running text, in their original order.
 */
export function deriveReadableItems(items: readonly TextItemBox[], pageWidth: number): TextItemBox[] {
  const mass = [0, 0, 0, 0];
  for (const it of items) { mass[it.orientation ?? 0]! += it.str.trim().length; }
  const dominant = mass.indexOf(Math.max(...mass));
  const upright = items.filter((it) => (it.orientation ?? 0) === dominant);

  const words = upright.filter((it) => it.str.trim().length > DEBRIS_MAX_CHARS && it.width > 0);
  if (words.length < MIN_WORDS_FOR_MARGINS || !(pageWidth > 0)) { return upright; }
  // Percentiles, not extremes: a stray long token in the margin must not move the text block's edge.
  const lefts = words.map((w) => w.x).sort((p, q) => p - q);
  const rights = words.map((w) => w.x + w.width).sort((p, q) => p - q);
  const bodyLeft = lefts[Math.floor((lefts.length - 1) * 0.05)]!;
  const bodyRight = rights[Math.floor((rights.length - 1) * 0.95)]!;
  return upright.filter((it) => {
    const text = it.str.trim();
    if (text.length === 0 || text.length > DEBRIS_MAX_CHARS || MARKER_SHAPED.test(text)) { return true; }
    const clearance = it.height * 2;
    return it.x + it.width >= bodyLeft - clearance && it.x <= bodyRight + clearance;
  });
}

/**
 * Looks for an empty vertical gutter near the middle of the page.
 * @returns the x that splits the two columns, or null for a single-column page.
 */
export function detectColumns(items: readonly TextItemBox[], pageWidth: number): number | null {
  const real = items.filter((i) => i.str.trim().length > 0 && i.width > 0);
  if (real.length < 20 || !(pageWidth > 0)) { return null; }
  const cover = new Array<number>(BINS).fill(0);
  for (const it of real) {
    const from = Math.max(0, Math.floor((it.x / pageWidth) * BINS));
    const to = Math.min(BINS - 1, Math.floor(((it.x + it.width) / pageWidth) * BINS));
    for (let b = from; b <= to; b++) { cover[b]! += 1; }
  }
  const peak = Math.max(...cover);
  let gutter = -1;
  let gutterCover = Infinity;
  for (let b = 35; b <= 65; b++) {
    if (cover[b]! < gutterCover) { gutterCover = cover[b]!; gutter = b; }
  }
  if (gutter < 0 || gutterCover > peak * 0.05) { return null; }
  const leftMass = cover.slice(0, gutter).reduce((a, c) => a + c, 0);
  const rightMass = cover.slice(gutter + 1).reduce((a, c) => a + c, 0);
  // A lone left column with a wide margin is not a two-column page.
  if (Math.min(leftMass, rightMass) < Math.max(leftMass, rightMass) * 0.25) { return null; }
  return ((gutter + 0.5) / BINS) * pageWidth;
}

function joinLine(parts: TextItemBox[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const p of parts) {
    if (prevEnd !== null) {
      const gap = p.x - prevEnd;
      const needsSpace = gap > p.height * 0.15 && !out.endsWith(" ") && !p.str.startsWith(" ");
      if (needsSpace) { out += " "; }
    }
    out += p.str;
    prevEnd = p.x + p.width;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * @returns lines in reading order: left column top-to-bottom, then right column.
 */
export function deriveLinesFromItems(items: readonly TextItemBox[], pageWidth: number): TextLine[] {
  const split = detectColumns(items, pageWidth);
  const columns: TextItemBox[][] = [[], []];
  for (const it of items) {
    if (it.str.trim().length === 0) { continue; }
    const col = split !== null && it.x + it.width / 2 > split ? 1 : 0;
    columns[col]!.push(it);
  }
  const lines: TextLine[] = [];
  columns.forEach((colItems, column) => {
    const sorted = [...colItems].sort((a, b) => b.y - a.y || a.x - b.x);
    let bucket: TextItemBox[] = [];
    const flush = (): void => {
      if (bucket.length === 0) { return; }
      const parts = [...bucket].sort((a, b) => a.x - b.x);
      const first = parts[0]!;
      const last = parts[parts.length - 1]!;
      const text = joinLine(parts);
      if (text) {
        lines.push({
          text,
          x: first.x,
          xEnd: last.x + last.width,
          y: first.y,
          height: Math.max(...parts.map((p) => p.height)),
          column,
        });
      }
      bucket = [];
    };
    for (const it of sorted) {
      const ref = bucket[0];
      if (ref && Math.abs(ref.y - it.y) > Math.max(ref.height, it.height, 1) * 0.5) { flush(); }
      bucket.push(it);
    }
    flush();
  });
  return lines;
}

// Locates figures, tables and numbered equations from page text alone, for PDFs without link annotations.
// A caption is a line that STARTS with the label; the float itself is the text-free band next to it.

export interface CaptionMatch {
  kind: FloatKind;
  /** Lower-cased label as printed: "3", "3a", "1.1". */
  label: string;
  lineIndex: number;
}

// "Figure 3.", "Fig. 3:", "FIGURA 1 –", "Table 2 Summary of…" — but not "Figure 3 shows that…" (a sentence that merely
// starts a line): after the number comes punctuation, the end of the line, or a capitalised word.
// The label is matched case-insensitively; what follows is checked separately, because under the `i` flag \p{Lu} would
// accept lower-case letters too.
const CAPTION_LABEL = new RegExp(`^(${FIGURE_WORD}|Tab(?:le|ela|la)?s?|Quadro|Cuadro|Gr[áa]fico|Chart)\\s*\\.?\\s*(${FLOAT_LABEL})(?![\\p{L}\\d])`, "iu");
const CAPTION_REST = /^\s*(?:[.:\-–—)]|$|\p{Lu})/u;
// A display equation is numbered at the right margin: "... = mc^2   (5)", or "(2.3)" when numbered within sections.
const EQUATION_TAIL = new RegExp(`\\((${FLOAT_LABEL})\\)\\s*$`);

/**
 * @returns every caption and numbered equation on a page, in reading order.
 */
export function findCaptionLines(lines: readonly TextLine[], pageWidth: number, columnSplit: number | null): CaptionMatch[] {
  const hits: CaptionMatch[] = [];
  lines.forEach((line, lineIndex) => {
    const text = line.text.trim();
    const label = CAPTION_LABEL.exec(text);
    const cap = label && CAPTION_REST.test(text.slice(label[0].length)) ? label : null;
    if (cap) {
      hits.push({ kind: deriveFloatKind(cap[1]!), label: cap[2]!.toLowerCase(), lineIndex });
      return;
    }
    const eq = EQUATION_TAIL.exec(text);
    if (eq) {
      // The number sits at the right edge of the TEXT block (not of the page, which has a margin), and the line is
      // mostly formula rather than a full line of prose that happens to end in "(5)".
      const [left, right] = deriveColumnBounds(line, pageWidth, columnSplit);
      const edge = textRightEdge(lines, left, right);
      const atRightEdge = line.xEnd >= edge - (edge - left) * 0.05;
      const startsIndented = line.x >= left + (edge - left) * 0.25;
      if (atRightEdge && startsIndented && text.length <= 90) {
        hits.push({ kind: "equation", label: eq[1]!.toLowerCase(), lineIndex });
      }
    }
  });
  return hits;
}

// Right edge of the running text inside [left, right]: a high percentile, so one stray wide line does not define it.
function textRightEdge(lines: readonly TextLine[], left: number, right: number): number {
  const ends = lines.filter((l) => l.xEnd > left + 2 && l.x < right - 2).map((l) => l.xEnd).sort((a, b) => a - b);
  return ends[Math.floor((ends.length - 1) * 0.9)] ?? right;
}

export function deriveColumnBounds(line: TextLine, pageWidth: number, columnSplit: number | null): [number, number] {
  if (columnSplit === null) { return [0, pageWidth]; }
  if (line.xEnd <= columnSplit + 6) { return [0, columnSplit]; }
  if (line.x >= columnSplit - 6) { return [columnSplit, pageWidth]; }
  // A caption straddling the gutter belongs to a float that spans both columns.
  return [0, pageWidth];
}

/**
 * Chooses the caption a reference points at: the exact label, else the label without its sub-figure letter ("3a" → "3").
 * @returns the index into `hits`, or -1.
 */
export function pickCaption(hits: ReadonlyArray<Pick<CaptionMatch, "kind" | "label">>, kind: FloatKind, label: string): number {
  const wanted = label.toLowerCase();
  const exact = hits.findIndex((h) => h.kind === kind && h.label === wanted);
  if (exact >= 0) { return exact; }
  const numeric = wanted.replace(/[a-z]$/, "");
  return hits.findIndex((h) => h.kind === kind && h.label.replace(/[a-z]$/, "") === numeric);
}
