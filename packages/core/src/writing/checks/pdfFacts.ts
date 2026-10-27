/** Reads a paper's PDF facts through pdf.js (text lines, fonts, placed images, info) and derives the paper body and the counts a venue limit applies to. */
import type { PdfjsLoader } from "../../import/index.js";
import type { LibraryFileSystem } from "../../ports/index.js";
import { countWords, removeComments, resolveIncludePath, type ProjectSourceFile } from "../../latex/index.js";
import { deriveLineOffsets } from "../../text/index.js";
import type { CountUpTo } from "../project/index.js";

// --- PDF facts ---

/** A raster image as placed on the page: its pixels and the size it is drawn at, in points. */
export interface PlacedFigure {
  pixelWidth: number;
  pixelHeight: number;
  width: number;
  height: number;
}

export interface PdfPageFacts {
  /** Text lines in content order. */
  lines: string[];
  /** Whether each font the page draws with is a Type 3 font. */
  fonts: Array<{ name: string; type3: boolean }>;
  images: PlacedFigure[];
}

export interface PdfFacts {
  pages: PdfPageFacts[];
  /** The info dictionary's text fields. */
  info: Record<string, string>;
}

// --- Page text lines ---

/** The part of a pdf.js text item that carries text. */
export interface PdfTextItem { str?: string; hasEOL?: boolean }

/** pdf.js ends a line with an empty item flagged `hasEOL`; the items between are pieces of one line. */
export function derivePdfTextLines(items: readonly PdfTextItem[]): string[] {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    line += item.str ?? "";
    if (item.hasEOL === true) { lines.push(line); line = ""; }
  }
  if (line !== "") { lines.push(line); }
  return lines;
}

// --- Operator walk ---

type Matrix = [number, number, number, number, number, number];

export interface OperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export interface PageOperators {
  /** pdf.js ids of the fonts the page sets, in first-use order. */
  fontIds: string[];
  images: PlacedFigure[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `ctm · m`, the order canvas `transform()` applies, which is how pdf.js replays the list. */
function multiply(ctm: Matrix, m: ArrayLike<number>): Matrix {
  return [
    ctm[0] * m[0]! + ctm[2] * m[1]!,
    ctm[1] * m[0]! + ctm[3] * m[1]!,
    ctm[0] * m[2]! + ctm[2] * m[3]!,
    ctm[1] * m[2]! + ctm[3] * m[3]!,
    ctm[0] * m[4]! + ctm[2] * m[5]! + ctm[4],
    ctm[1] * m[4]! + ctm[3] * m[5]! + ctm[5],
  ];
}

const isMatrix = (value: unknown): value is ArrayLike<number> =>
  value !== null && typeof value === "object" && (value as ArrayLike<number>).length === 6;

/**
 * Tracks the transform through save/restore and form XObjects, because an image is drawn into the unit square of the
 * current transform: its drawn size is the length of the transform's two axis vectors.
 */
export function walkOperators(list: OperatorList, OPS: Record<string, number>): PageOperators {
  const fontIds: string[] = [];
  const images: PlacedFigure[] = [];
  const stack: Matrix[] = [];
  let ctm = IDENTITY;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = (list.argsArray[i] ?? []) as unknown[];
    if (fn === OPS["save"]) { stack.push(ctm); continue; }
    if (fn === OPS["restore"] || fn === OPS["paintFormXObjectEnd"]) { ctm = stack.pop() ?? IDENTITY; continue; }
    if (fn === OPS["transform"]) { ctm = multiply(ctm, args as number[]); continue; }
    if (fn === OPS["paintFormXObjectBegin"]) {
      stack.push(ctm);
      if (isMatrix(args[0])) { ctm = multiply(ctm, args[0]); }
      continue;
    }
    if (fn === OPS["setFont"] && typeof args[0] === "string" && !fontIds.includes(args[0])) { fontIds.push(args[0]); continue; }
    if (fn === OPS["paintImageXObject"] && typeof args[1] === "number" && typeof args[2] === "number") {
      images.push({ pixelWidth: args[1], pixelHeight: args[2], width: Math.hypot(ctm[0], ctm[1]), height: Math.hypot(ctm[2], ctm[3]) });
    }
  }
  return { fontIds, images };
}

// --- Reading the PDF ---

interface FontObject { name?: string; isType3Font?: boolean }

interface CheckPage {
  getOperatorList(): Promise<OperatorList>;
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  commonObjs: { has(id: string): boolean; get(id: string): unknown };
}

interface CheckDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<CheckPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
}

async function pageFacts(page: CheckPage, OPS: Record<string, number>): Promise<PdfPageFacts> {
  // INVARIANT: a page's fonts are in commonObjs once its operator list has resolved.
  const { fontIds, images } = walkOperators(await page.getOperatorList(), OPS);
  const fonts = fontIds.map((id) => {
    const font = (page.commonObjs.has(id) ? page.commonObjs.get(id) : undefined) as FontObject | undefined;
    return { name: font?.name ?? id, type3: font?.isType3Font === true };
  });
  return { lines: derivePdfTextLines((await page.getTextContent()).items), fonts, images };
}

function textFields(info: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(info ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function readPdfFacts(fs: LibraryFileSystem, pdfjs: PdfjsLoader, pdfPath: string): Promise<PdfFacts> {
  const bytes = await fs.readFile(pdfPath);
  // Font faces are for drawing; the check only reads font descriptions.
  const task = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
  try {
    const document = (await task.promise) as unknown as CheckDocument;
    const { OPS } = (await pdfjs.load()) as { OPS: Record<string, number> };
    const pages: PdfPageFacts[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      pages.push(await pageFacts(await document.getPage(number), OPS));
    }
    return { pages, info: textFields((await document.getMetadata()).info) };
  } finally {
    // pdf.js 6 has no PDFDocumentProxy.destroy(); the loading task owns teardown.
    await task.destroy();
  }
}

// --- Paper body ---

export interface PaperBody {
  /** Pages that hold body text: every page when no references heading is found. */
  contentPages: number;
  headingFound: boolean;
  /** Text lines of each page before the references heading. */
  pages: string[][];
}

const HEADING = /^(?:[A-Z]|\d+(?:\.\d+)*)?\.?\s*(?:references|bibliography|works cited)\s*$/i;
const PAGE_NUMBER = /^\s*\d*\s*$/;

/** Running headers and footers repeat on most pages; numbers are blanked so "Page 3" and "Page 4" count as one line. */
function repeatedLines(pages: string[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const line of new Set(lines.map((text) => text.replace(/\d+/g, "#").trim()))) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => pages.length > 1 && count > pages.length / 2).map(([line]) => line));
}

function findHeading(pages: string[][]): { page: number; line: number } | undefined {
  for (const [page, lines] of pages.entries()) {
    const line = lines.findIndex((text) => HEADING.test(text.trim()));
    if (line >= 0) { return { page, line }; }
  }
  return undefined;
}

/** The page holding the heading counts when body text precedes the heading on it. */
export function derivePaperBody(pages: string[][]): PaperBody {
  const heading = findHeading(pages);
  if (heading === undefined) { return { contentPages: pages.length, headingFound: false, pages }; }
  const repeated = repeatedLines(pages);
  const before = pages[heading.page]!.slice(0, heading.line);
  const bodyBefore = before.some((text) => !PAGE_NUMBER.test(text) && !repeated.has(text.replace(/\d+/g, "#").trim()));
  return {
    contentPages: heading.page + (bodyBefore ? 1 : 0),
    headingFound: true,
    pages: [...pages.slice(0, heading.page), before],
  };
}

// --- Counted pages and words ---

export function deriveCountedPages(body: PaperBody, totalPages: number, countUpTo: CountUpTo): { pages: number; headingFound: boolean } {
  return { pages: countUpTo === "end" ? totalPages : body.contentPages, headingFound: body.headingFound };
}

const BIBLIOGRAPHY = /\\(?:print)?bibliography|#bibliography/;

/** `sources` are the root's texts in reading order, each include placed where it is written. */
export function countWordsUpTo(sources: readonly { text: string }[], countUpTo: CountUpTo): number {
  const text = removeComments(sources.map((source) => source.text).join("\n"));
  if (countUpTo === "end") { return countWords(text); }
  const body = text.indexOf("\\begin{document}");
  const stop = text.slice(Math.max(body, 0)).search(BIBLIOGRAPHY);
  return countWords(stop < 0 ? text : text.slice(0, Math.max(body, 0) + stop));
}

/** `files` lists the main file first; a file reached twice is placed at its first include only. */
export function deriveReadingOrderTexts(files: readonly ProjectSourceFile[], texts: ReadonlyMap<string, string>): { text: string }[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const placed = new Set<string>();
  const pieces: { text: string }[] = [];
  const place = (file: ProjectSourceFile): void => {
    placed.add(file.path);
    const text = texts.get(file.path) ?? "";
    const starts = deriveLineOffsets(text);
    let cursor = 0;
    for (const include of file.facts.includes) {
      const target = resolveIncludePath(include.path);
      const child = target === undefined || placed.has(target) ? undefined : byPath.get(target);
      if (child === undefined) { continue; }
      const { start, end } = include.range;
      // TRAP: the include range covers the path argument only, so the cut moves back to the command's backslash and past the closing brace.
      const argumentStart = (starts[start.line] ?? 0) + start.character;
      const argumentEnd = (starts[end.line] ?? 0) + end.character;
      pieces.push({ text: text.slice(cursor, Math.max(cursor, text.lastIndexOf("\\", argumentStart))) });
      place(child);
      cursor = text[argumentEnd] === "}" ? argumentEnd + 1 : argumentEnd;
    }
    pieces.push({ text: text.slice(cursor) });
  };
  const main = files[0];
  if (main !== undefined) { place(main); }
  return pieces;
}
