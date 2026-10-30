// Classifies a link destination and derives the page region or caption it previews. Pure: geometry in, geometry out.
import type { PdfRegion } from "./geometry.js";
import { FIGURE_WORD, FLOAT_LABEL, deriveFloatKind, type FloatKind } from "./inTextReferences.js";
import { deriveColumnBounds, findCaptionLines, pickCaption, type CaptionMatch, type TextLine } from "./textLines.js";

export type DestTarget = { kind: "statement" } | { kind: "float"; floatKind: FloatKind; label: string | null };

export interface PageLayout { width: number; height: number; columnSplit: number | null }

/** Destination as PDF user space (y up); x is null when the destination does not fix a horizontal position. */
export interface DestPoint { x: number | null; y: number }

const STATEMENT_NAME_WORDS = new Set([
  "theorem", "thm", "lemma", "lem", "proposition", "prop", "corollary", "cor", "definition", "defn", "def", "remark", "rem",
  "conjecture", "conj", "claim", "example", "exercise", "problem", "assumption", "hypothesis", "notation", "observation",
  "fact", "question", "property",
]);
const FLOAT_NAME_WORDS = new Map<string, FloatKind>([
  ["figure", "figure"], ["subfigure", "figure"],
  ["table", "table"], ["subtable", "table"],
  ["equation", "equation"], ["eq", "equation"], ["ams", "equation"],
]);
const FLOAT_LABEL_EXACT = new RegExp(`^${FLOAT_LABEL}$`);

/**
 * @returns what a named destination ("theorem.2.1", "figure.3") points at, or null for anything else.
 */
export function classifyDestName(name: string): DestTarget | null {
  const lower = name.toLowerCase();
  const sep = lower.search(/[.:]/);
  const head = sep < 0 ? lower : lower.slice(0, sep);
  if (STATEMENT_NAME_WORDS.has(head)) { return { kind: "statement" }; }
  const floatKind = FLOAT_NAME_WORDS.get(head);
  if (!floatKind) { return null; }
  const rest = sep < 0 ? "" : lower.slice(sep + 1);
  return { kind: "float", floatKind, label: FLOAT_LABEL_EXACT.test(rest) ? rest : null };
}

const STATEMENT_WORDS_FULL =
  "theorem|lemma|proposition|corollary|definition|remark|conjecture|claim|example|exercise|problem|assumption|hypothesis|notation|observation|fact|question|property|" +
  "teorema|lema|proposição|corolário|definição|observação|exemplo";
const NOT_AFTER_LETTER = "(?<![\\p{L}\\d])";
const STATEMENT_LINK_END = new RegExp(
  `${NOT_AFTER_LETTER}(?:(?:${STATEMENT_WORDS_FULL})s?|(?:thm|lem|prop|cor|defn|def)s?\\.?)\\.?\\s*${FLOAT_LABEL}\\s*$`,
  "iu",
);
const FIGURE_TABLE_LINK_END = new RegExp(
  `${NOT_AFTER_LETTER}(${FIGURE_WORD}|Tab(?:le|ela|la)?s?)\\s*\\.?\\s*\\(?\\s*(${FLOAT_LABEL})\\s*\\)?\\s*$`,
  "iu",
);
const EQUATION_LINK_END = new RegExp(
  `${NOT_AFTER_LETTER}Eq(?:uation|ua[çc][ãa]o|ua[çc][õo]es|uaci[óo]n)?s?\\s*\\.?\\s*(?:\\(\\s*(${FLOAT_LABEL})\\s*\\)|(${FLOAT_LABEL}))?\\s*$`,
  "iu",
);
const BARE_LABEL_LINK_END = new RegExp(`\\(\\s*(${FLOAT_LABEL})\\s*\\)\\s*$`, "iu");

/**
 * @param text the visual line up to the end of the link; only its end is read.
 * @returns what the text that ends at the link says it refers to ("by Theorem 2.1", "Fig. 4", "(3.1)"), or null.
 */
export function classifyLinkText(text: string): DestTarget | null {
  // Punctuation after the link ("Theorem 1.2.", "(see Fig. 3)") is not part of it; "(3.1)" keeps its parenthesis.
  for (let t = text.trimEnd(); t; t = t.slice(0, -1).trimEnd()) {
    const target = classifyLinkTextEnd(t);
    if (target || !TRAILING_PUNCTUATION.test(t)) { return target; }
  }
  return null;
}

const TRAILING_PUNCTUATION = /[.,;:)]$/;

function classifyLinkTextEnd(text: string): DestTarget | null {
  if (STATEMENT_LINK_END.test(text)) { return { kind: "statement" }; }
  const fig = FIGURE_TABLE_LINK_END.exec(text);
  if (fig) { return { kind: "float", floatKind: deriveFloatKind(fig[1]!), label: fig[2]!.toLowerCase() }; }
  const eq = EQUATION_LINK_END.exec(text);
  if (eq) { return { kind: "float", floatKind: "equation", label: (eq[1] ?? eq[2])?.toLowerCase() ?? null }; }
  const bare = BARE_LABEL_LINK_END.exec(text);
  if (bare) { return { kind: "float", floatKind: "equation", label: bare[1]!.toLowerCase() }; }
  return null;
}

const START_REACH_SLACK = 2;
const MAX_START_DISTANCE_LINES = 3;
const MAX_START_DISTANCE_PAD = 12;
const MIN_PITCH_GAPS = 3;
const FALLBACK_PITCH_RATIO = 1.2;
const DISPLAY_INDENT_RATIO = 0.12;
const GAP_PITCH_RATIO = 1.45;
const DISPLAY_GAP_PITCH_RATIO = 3;
const MAX_HEIGHT_RATIO = 0.5;
const X_PAD = 6;
const TOP_PAD_RATIO = 1.4;
const BOTTOM_PAD_RATIO = 0.6;
const MAX_HEADING_CHARS = 70;

const PROOF_START = /^(?:Proof|Demonstração|Prova)(?![\p{L}\d])/iu;
const STATEMENT_HEADING_START = new RegExp(`^(?:${STATEMENT_WORDS_FULL})\\s*(?:\\d|\\(|\\.|:)`, "iu");
const SECTION_HEADING_START = /^(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+\p{Lu}/u;

function isSectionHeading(text: string): boolean {
  return SECTION_HEADING_START.test(text) && text.length <= MAX_HEADING_CHARS && !/[.,;:]$/.test(text);
}

function endsStatement(text: string): boolean {
  return PROOF_START.test(text) || STATEMENT_HEADING_START.test(text) || isSectionHeading(text);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// The column a destination sits in, or null when the page has one column or the destination has no x.
function destColumn(page: PageLayout, dest: DestPoint): number | null {
  if (page.columnSplit === null) { return 0; }
  if (dest.x === null) { return null; }
  return dest.x > page.columnSplit ? 1 : 0;
}

// The statement's first line: its heading below the anchor, else the first line whose top is under the destination.
function findRegionStart(lines: readonly TextLine[], page: PageLayout, dest: DestPoint): TextLine | null {
  const heading = findStatementStart(lines, page, dest);
  if (heading !== null) { return lines[heading]!; }
  const wantedColumn = destColumn(page, dest);
  let start: TextLine | null = null;
  for (const l of lines) {
    if (wantedColumn !== null && l.column !== wantedColumn) { continue; }
    if (l.y + l.height <= dest.y + 1 && (start === null || l.y > start.y)) { start = l; }
  }
  if (!start || dest.y - start.y > MAX_START_DISTANCE_LINES * start.height + MAX_START_DISTANCE_PAD) { return null; }
  return start;
}

/**
 * Derives the region a theorem-like statement occupies: from the line under the destination down to the line before
 * the proof, the next statement, a section heading, a large gap or half a page.
 * @returns the region in PDF space, or null when no line lies under the destination within reach.
 */
export function deriveStatementRegion(lines: readonly TextLine[], page: PageLayout, dest: DestPoint): PdfRegion | null {
  const start = findRegionStart(lines, page, dest);
  if (!start) { return null; }

  const column = lines.filter((l) => l.column === start.column).sort((a, b) => b.y - a.y);
  const startIndex = column.indexOf(start);
  const gaps: number[] = [];
  for (let i = 1; i < column.length; i++) {
    const gap = column[i - 1]!.y - column[i]!.y;
    if (gap > 0) { gaps.push(gap); }
  }
  const pitch = gaps.length < MIN_PITCH_GAPS ? FALLBACK_PITCH_RATIO * start.height : median(gaps);

  const textLeft = Math.min(...column.map((l) => l.x));
  const textRight = Math.max(...column.map((l) => l.xEnd));
  const isDisplay = (l: TextLine): boolean => l.x - textLeft >= DISPLAY_INDENT_RATIO * (textRight - textLeft);

  const yTop = start.y + TOP_PAD_RATIO * start.height;
  const maxHeight = page.height * MAX_HEIGHT_RATIO;
  const included: TextLine[] = [start];
  for (let i = startIndex + 1; i < column.length; i++) {
    const line = column[i]!;
    const prev = included[included.length - 1]!;
    if (endsStatement(line.text.trim())) { break; }
    const limit = (isDisplay(prev) || isDisplay(line) ? DISPLAY_GAP_PITCH_RATIO : GAP_PITCH_RATIO) * pitch;
    if (prev.y - line.y > limit) { break; }
    if (yTop - (line.y - BOTTOM_PAD_RATIO * line.height) > maxHeight) { break; }
    included.push(line);
  }

  const last = included[included.length - 1]!;
  const [columnLeft, columnRight] = deriveColumnBounds(start, page.width, page.columnSplit);
  const clampY = (y: number): number => Math.min(page.height, Math.max(0, y));
  return {
    x0: Math.max(columnLeft, Math.min(...included.map((l) => l.x)) - X_PAD),
    x1: Math.min(columnRight, Math.max(...included.map((l) => l.xEnd)) + X_PAD),
    yTop: clampY(yTop),
    yBottom: clampY(last.y - BOTTOM_PAD_RATIO * last.height),
  };
}

/**
 * Picks the caption (or numbered equation line) a float destination refers to: the exact label when found, else the
 * one at or below the destination in its column, else the nearest.
 * @returns the caption match, or null when the page has no caption of that kind.
 */
export function findFloatCaptionNear(
  lines: readonly TextLine[],
  page: PageLayout,
  target: { floatKind: FloatKind; label: string | null },
  dest: DestPoint,
): CaptionMatch | null {
  const hits = findCaptionLines(lines, page.width, page.columnSplit).filter((h) => h.kind === target.floatKind);
  if (target.label !== null) {
    const found = pickCaption(hits, target.floatKind, target.label);
    if (found >= 0) { return hits[found]!; }
  }
  const column = page.columnSplit === null ? null : destColumn(page, dest);
  const near = column === null ? hits : hits.filter((h) => lines[h.lineIndex]!.column === column);
  const yOf = (h: CaptionMatch): number => lines[h.lineIndex]!.y;
  let below: CaptionMatch | null = null;
  let nearest: CaptionMatch | null = null;
  for (const h of near) {
    if (yOf(h) <= dest.y + START_REACH_SLACK && (below === null || yOf(h) > yOf(below))) { below = h; }
    if (nearest === null || Math.abs(yOf(h) - dest.y) < Math.abs(yOf(nearest) - dest.y)) { nearest = h; }
  }
  return below ?? nearest;
}

const HEADING_LOOKAHEAD_LINES = 3;
const HEADING_REACH_PAD = 30;

/**
 * Finds the heading of a theorem-like statement a destination anchors: hyperref puts the anchor in the gap above the
 * heading, 26-34 pt over its baseline, so one of the first lines below the destination must open with a statement word.
 * @returns the index into `lines` of that heading line, or null when none of the first lines below is one.
 */
export function findStatementStart(lines: readonly TextLine[], page: PageLayout, dest: DestPoint): number | null {
  const wantedColumn = destColumn(page, dest);
  const under = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (wantedColumn === null || l.column === wantedColumn) && l.y < dest.y + START_REACH_SLACK)
    .sort((a, b) => b.l.y - a.l.y);
  // Without a column from the destination, the first line under it decides the column (as in deriveStatementRegion).
  const column = wantedColumn ?? under[0]?.l.column;
  const below = under.filter(({ l }) => l.column === column).slice(0, HEADING_LOOKAHEAD_LINES);
  for (const { l, i } of below) {
    if (dest.y - l.y > HEADING_LOOKAHEAD_LINES * l.height + HEADING_REACH_PAD) { break; }
    if (STATEMENT_HEADING_START.test(l.text.trim())) { return i; }
  }
  return null;
}
