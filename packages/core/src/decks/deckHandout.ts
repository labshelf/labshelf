// Turns a talk's slide PDF into a handout (2, 3, 4 or 6 slides per A4 page) or into notes pages (slide above its speaker notes), for HTML, LaTeX and Typst talks alike.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, rgb, StandardFonts, type PDFEmbeddedPage, type PDFFont, type PDFPage } from "pdf-lib";

import { plainSourceText } from "./sourceDeckPositions.js";

export type TalkPdfLayout = { kind: "handout"; perPage: 2 | 3 | 4 | 6 } | { kind: "notes" };

export interface TalkPdfChoice { label: string; detail: string; layout: TalkPdfLayout | null }

/**
 * The speaker notes of a talk: one per outline slide, and the markup they are written in. From the build's page map of a LaTeX talk,
 * `slideOfPage` is each PDF page's outline slide (-1 for none; slidesOfPages) and `unitOfPage` the source unit that shipped it
 * (pageUnitKeys), whose consecutive pages are one slide's overlays. Absent, page n is slide n when the counts match (an HTML talk's export)
 * and a run of equal page labels is one slide.
 */
export interface TalkPdfNotes { notes: readonly string[]; slideOfPage?: readonly number[]; unitOfPage?: readonly string[]; format?: "latex" | "typst" }

/** The PDF choices a host offers before exporting a talk, in order. */
export const TALK_PDF_CHOICES: readonly [TalkPdfChoice, TalkPdfChoice, TalkPdfChoice, TalkPdfChoice, TalkPdfChoice, TalkPdfChoice] = [
  { label: "PDF", detail: "One slide per page", layout: null },
  { label: "Handout, 2 per page", detail: "Two slides per A4 page", layout: { kind: "handout", perPage: 2 } },
  { label: "Handout, 3 per page", detail: "Three slides per A4 page with lines for notes", layout: { kind: "handout", perPage: 3 } },
  { label: "Handout, 4 per page", detail: "Four slides per A4 page", layout: { kind: "handout", perPage: 4 } },
  { label: "Handout, 6 per page", detail: "Six slides per A4 page", layout: { kind: "handout", perPage: 6 } },
  { label: "Notes pages", detail: "Each slide above its speaker notes", layout: { kind: "notes" } },
];

const SHEET_W = 595.28;
const SHEET_H = 841.89;
const MARGIN = 36;
const CELL_GAP = 12;
const FRAME_WIDTH = 0.5;
const FRAME_COLOR = rgb(0.6, 0.6, 0.6);
const RULE_SPACING = 18;
const NOTE_SIZE = 11;
const NOTE_LEADING = 14;
const SLIDE_NOTE_GAP = 18;
const MAX_NESTING = 16;

interface Rect { x: number; y: number; width: number; height: number }

interface LabelRange { start: number; style: string | null; first: number; prefix: string }

function textOf(dict: PDFDict, key: string): string {
  const value = dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString);
  return value ? value.decodeText() : "";
}

function collectLabelRanges(node: PDFDict, ranges: LabelRange[], depth: number): void {
  const nums = node.lookupMaybe(PDFName.of("Nums"), PDFArray);
  if (nums) {
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const start = nums.lookupMaybe(i, PDFNumber);
      const dict = nums.lookupMaybe(i + 1, PDFDict);
      if (!start || !dict) continue;
      const style = dict.lookupMaybe(PDFName.of("S"), PDFName);
      const first = dict.lookupMaybe(PDFName.of("St"), PDFNumber);
      ranges.push({ start: start.asNumber(), style: style ? style.decodeText() : null, first: first ? first.asNumber() : 1, prefix: textOf(dict, "P") });
    }
  }
  const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
  if (kids && depth < MAX_NESTING) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) collectLabelRanges(kid, ranges, depth + 1);
    }
  }
}

/**
 * The page labels of a PDF from its /PageLabels number tree: decimal ranges give prefix + number (from /St, default 1), any other style or
 * none gives the prefix alone. null when the PDF has no /PageLabels.
 */
export async function readPdfPageLabels(pdf: Uint8Array): Promise<string[] | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return pageLabelsOf(doc);
}

function pageLabelsOf(doc: PDFDocument): string[] | null {
  const root = doc.catalog.lookupMaybe(PDFName.of("PageLabels"), PDFDict);
  if (!root) return null;
  const ranges: LabelRange[] = [];
  collectLabelRanges(root, ranges, 0);
  if (ranges.length === 0) return null;
  ranges.sort((a, b) => a.start - b.start);
  return Array.from({ length: doc.getPageCount() }, (_, page) => {
    let range: LabelRange | undefined;
    for (const candidate of ranges) {
      if (candidate.start <= page) range = candidate;
    }
    if (!range) return "";
    return range.style === "D" ? `${range.prefix}${range.first + page - range.start}` : range.prefix;
  });
}

/**
 * The page index each slide ends on: one slide per run of equal consecutive keys (the source units of the build's page map, else the page
 * labels), its last page (the final overlay state); every page without keys.
 */
function slideLastPages(keys: readonly string[] | null, pageCount: number): number[] {
  const last: number[] = [];
  for (let page = 0; page < pageCount; page++) {
    if (keys && page + 1 < pageCount && keys[page] === keys[page + 1]) continue;
    last.push(page);
  }
  return last;
}

/** The scale and origin that fit a (width x height) slide into `cell`, centred. */
function fitInto(cell: Rect, width: number, height: number): Rect {
  const scale = Math.min(cell.width / width, cell.height / height);
  const w = width * scale;
  const h = height * scale;
  return { x: cell.x + (cell.width - w) / 2, y: cell.y + (cell.height - h) / 2, width: w, height: h };
}

function drawSlide(sheet: PDFPage, slide: PDFEmbeddedPage, cell: Rect): Rect {
  const box = fitInto(cell, slide.width, slide.height);
  sheet.drawPage(slide, box);
  sheet.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: FRAME_COLOR, borderWidth: FRAME_WIDTH });
  return box;
}

const HANDOUT_GRID: Record<2 | 3 | 4 | 6, { columns: number; rows: number }> = {
  2: { columns: 1, rows: 2 },
  3: { columns: 1, rows: 3 },
  4: { columns: 2, rows: 2 },
  6: { columns: 2, rows: 3 },
};

function drawHandout(out: PDFDocument, slides: readonly PDFEmbeddedPage[], perPage: 2 | 3 | 4 | 6): void {
  const { columns, rows } = HANDOUT_GRID[perPage];
  const contentW = SHEET_W - 2 * MARGIN;
  const contentH = SHEET_H - 2 * MARGIN;
  // With lines for notes (3 per page) the slide takes the left half of its row and the lines the right half.
  const cellW = perPage === 3 ? (contentW - CELL_GAP) / 2 : (contentW - CELL_GAP * (columns - 1)) / columns;
  const cellH = (contentH - CELL_GAP * (rows - 1)) / rows;
  for (let first = 0; first < slides.length; first += perPage) {
    const sheet = out.addPage([SHEET_W, SHEET_H]);
    for (let slot = 0; slot < perPage && first + slot < slides.length; slot++) {
      const row = Math.floor(slot / columns);
      const column = slot % columns;
      const cell = { x: MARGIN + column * (cellW + CELL_GAP), y: SHEET_H - MARGIN - (row + 1) * cellH - row * CELL_GAP, width: cellW, height: cellH };
      drawSlide(sheet, slides[first + slot]!, cell);
      if (perPage !== 3) continue;
      const ruleX = cell.x + cellW + CELL_GAP;
      for (let y = cell.y + RULE_SPACING; y <= cell.y + cellH; y += RULE_SPACING) {
        sheet.drawLine({ start: { x: ruleX, y }, end: { x: ruleX + cellW, y }, thickness: FRAME_WIDTH, color: FRAME_COLOR });
      }
    }
  }
}

/** One line of note text with every character Helvetica (WinAnsi) cannot encode replaced by "?". */
function encodable(text: string, font: PDFFont): string {
  const known = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\t/g, " ")).map((char) => (known.has(char.codePointAt(0)!) ? char : "?")).join("");
}

/** A note as wrapped lines for `width`; blank lines of the note stay as empty lines (paragraph breaks). */
function wrapNote(note: string, font: PDFFont, width: number): string[] {
  const lines: string[] = [];
  const fits = (text: string): boolean => font.widthOfTextAtSize(text, NOTE_SIZE) <= width;
  for (const paragraph of note.split(/\r\n|\r|\n/)) {
    const words = encodable(paragraph, font).split(/ +/).filter((word) => word !== "");
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (let word of words) {
      if (line !== "" && fits(`${line} ${word}`)) {
        line = `${line} ${word}`;
        continue;
      }
      if (line !== "") lines.push(line);
      line = "";
      // A word wider than the text width is cut into pieces that fit.
      while (!fits(word) && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && !fits(word.slice(0, cut))) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    lines.push(line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function drawNotesPages(out: PDFDocument, slides: readonly PDFEmbeddedPage[], notes: readonly string[], font: PDFFont): void {
  const width = SHEET_W - 2 * MARGIN;
  slides.forEach((slide, index) => {
    let sheet = out.addPage([SHEET_W, SHEET_H]);
    const top = SHEET_H - MARGIN;
    const box = drawSlide(sheet, slide, { x: MARGIN, y: top - SHEET_H / 2, width, height: SHEET_H / 2 });
    const lines = wrapNote(notes[index] ?? "", font, width);
    let y = box.y - SLIDE_NOTE_GAP - NOTE_SIZE;
    for (const line of lines) {
      if (y < MARGIN) {
        sheet = out.addPage([SHEET_W, SHEET_H]);
        y = top - NOTE_SIZE;
      }
      if (line !== "") sheet.drawText(line, { x: MARGIN, y, size: NOTE_SIZE, font });
      y -= NOTE_LEADING;
    }
  });
}

/** The speaker note of each slide of the PDF, '' when none can be placed; `format` turns LaTeX or Typst markup into plain words. */
function notesOfSlides(talk: TalkPdfNotes, pageCount: number, lastPages: readonly number[]): string[] {
  const map = talk.slideOfPage ?? (pageCount === talk.notes.length ? talk.notes.map((_, i) => i) : []);
  return lastPages.map((page) => {
    const slide = map[page] ?? -1;
    const note = slide >= 0 ? talk.notes[slide] ?? "" : "";
    return talk.format ? plainSourceText(talk.format, note) : note;
  });
}

/**
 * Lays the slides of a talk's PDF out as a handout (A4 sheets of 2, 3, 4 or 6 slides) or as notes pages (each slide above its notes, long
 * notes continuing on text-only sheets). A slide is a run of pages of one source unit (or of equal page labels), shown by its last page.
 * @throws Error "The PDF has no pages" for a PDF without pages.
 * @returns deterministic bytes (no metadata, no dates).
 */
export async function layoutTalkPdf(pdf: Uint8Array, layout: TalkPdfLayout, talk: TalkPdfNotes): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  const pageCount = source.getPageCount();
  if (pageCount === 0) throw new Error("The PDF has no pages");
  const lastPages = slideLastPages(talk.unitOfPage ?? pageLabelsOf(source), pageCount);
  const out = await PDFDocument.create({ updateMetadata: false });
  const slides = await out.embedPages(lastPages.map((page) => source.getPage(page)));
  if (layout.kind === "handout") {
    drawHandout(out, slides, layout.perPage);
  } else {
    const font = await out.embedFont(StandardFonts.Helvetica);
    drawNotesPages(out, slides, notesOfSlides(talk, pageCount, lastPages), font);
  }
  return out.save();
}
