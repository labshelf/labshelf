/**
 * Locates figures, tables and numbered equations from the page text alone, so "Fig. 3" can be previewed in PDFs that
 * carry no link annotations (scans made searchable by OCR, papers typeset without hyperlinks).
 * A caption is a line that STARTS with the label; the float itself is the text-free band next to it.
 */
import { FIGURE_WORD, FLOAT_LABEL, floatKindOf, type FloatKind } from "./inTextRefs.js";
import type { TextLine } from "./textLines.js";

export interface CaptionHit {
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
export function findCaptionLines(lines: readonly TextLine[], pageWidth: number, columnSplit: number | null): CaptionHit[] {
  const hits: CaptionHit[] = [];
  lines.forEach((line, lineIndex) => {
    const text = line.text.trim();
    const label = CAPTION_LABEL.exec(text);
    const cap = label && CAPTION_REST.test(text.slice(label[0].length)) ? label : null;
    if (cap) {
      hits.push({ kind: floatKindOf(cap[1]!), label: cap[2]!.toLowerCase(), lineIndex });
      return;
    }
    const eq = EQUATION_TAIL.exec(text);
    if (eq) {
      // The number sits at the right edge of the TEXT block (not of the page, which has a margin), and the line is
      // mostly formula rather than a full line of prose that happens to end in "(5)".
      const [left, right] = columnBounds(line, pageWidth, columnSplit);
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

export function columnBounds(line: TextLine, pageWidth: number, columnSplit: number | null): [number, number] {
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
export function pickCaption(hits: ReadonlyArray<Pick<CaptionHit, "kind" | "label">>, kind: FloatKind, label: string): number {
  const wanted = label.toLowerCase();
  const exact = hits.findIndex((h) => h.kind === kind && h.label === wanted);
  if (exact >= 0) { return exact; }
  const numeric = wanted.replace(/[a-z]$/, "");
  return hits.findIndex((h) => h.kind === kind && h.label.replace(/[a-z]$/, "") === numeric);
}
