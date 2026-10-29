// Reads the text of pdf pages and resolves citations and figure or table floats from it.
import { deriveFloatRegion, type PdfRegion } from "../geometry.js";
import type { FloatKind } from "../inTextReferences.js";
import { findEntryAtY, findEntryByNumber, findReferencesStart, matchAuthorYear, splitReferenceEntries, type AuthorYearQuery, type ReferenceEntry } from "../referenceList.js";
import {
  type TextLine, findCaptionLines, pickCaption, detectColumns, deriveLinesFromItems, deriveReadableItems, runOrientation, type TextItemBox,
} from "../textLines.js";
import type { ReaderContext } from "./readerSession.js";

/**
 * Locates the References section and extracts the entry a citation link points at. Text extraction and layout analysis are lazy and cached per page.
 */

interface ResolvedEntry {
  text: string;
  pageNumber: number;
  /** Top of the entry's first line in PDF space, for jumping to it. */
  y: number;
}

interface ReferencesRegion {
  pageNumber: number;
  headingLine: TextLine;
  headingIndex: number;
}

// References sit at the back; scanning further forward mostly finds "References" inside a table of contents.
const SCAN_FRACTION = 0.4;
const MIN_SCAN_PAGES = 4;
// Books keep references per chapter; extracting hundreds of pages of text on the first hover would find nothing useful.
const MAX_SCAN_PAGES = 60;
const MAX_REFERENCE_PAGES = 25;

export class CitationResolver {
  private readonly entries = new Map<number, ReferenceEntry[]>();
  private region: Promise<ReferencesRegion | null> | null = null;

  constructor(private readonly pages: PageTextCache) {}

  /**
   * Finds the References section in the background so the first citation hover does not pay for it.
   */
  warmUp(): void {
    void this.getRegion().catch(() => null);
  }

  /**
   * @returns true when a destination lands inside the References section.
   */
  async isInReferences(pageNumber: number, y: number | null, x: number | null): Promise<boolean> {
    const region = await this.getRegion();
    if (!region) { return false; }
    if (pageNumber !== region.pageNumber) { return pageNumber > region.pageNumber; }
    if (y === null) { return false; }
    const { columnSplit } = await this.pages.get(pageNumber);
    // In a two-column page the list may continue at the top of the right column, above the heading's y.
    const destColumn = columnSplit !== null && x !== null && x > columnSplit ? 1 : 0;
    return destColumn > region.headingLine.column || y <= region.headingLine.y + region.headingLine.height;
  }

  /**
   * @returns the reference text at a destination, or null when the layout gives no reliable entry boundaries.
   */
  async entryAt(pageNumber: number, y: number, x: number | null): Promise<string | null> {
    const entries = await this.pageEntries(pageNumber);
    const { columnSplit } = await this.pages.get(pageNumber);
    return findEntryAtY(entries, { y, x, columnSplit })?.text ?? null;
  }

  /**
   * Numeric lookup for PDFs whose citations are plain text. Scans the pages from the heading onward.
   * @returns the entry text and its page, or null.
   */
  async entryNumbered(n: number): Promise<ResolvedEntry | null> {
    const region = await this.getRegion();
    if (!region) { return null; }
    const last = this.lastReferencesPage(region);
    for (let p = region.pageNumber; p <= last; p++) {
      const hit = findEntryByNumber(await this.pageEntries(p), n);
      if (hit) { return { text: hit.text, pageNumber: p, y: hit.yFirst + hit.lineHeight }; }
    }
    return null;
  }

  /**
   * Lookup for author–year citations ("(SILVA; COSTA, 2020)", "Souza et al. (2019)") in PDFs whose citations are plain text.
   * @returns the matching entries with their page (several when the list has several candidates), or [].
   */
  async entriesByAuthorYear(query: AuthorYearQuery): Promise<ResolvedEntry[]> {
    const region = await this.getRegion();
    if (!region) { return []; }
    const out: ResolvedEntry[] = [];
    const last = this.lastReferencesPage(region);
    for (let p = region.pageNumber; p <= last && out.length < 3; p++) {
      for (const hit of matchAuthorYear(await this.pageEntries(p), query)) {
        if (out.length < 3) { out.push({ text: hit.text, pageNumber: p, y: hit.yFirst + hit.lineHeight }); }
      }
    }
    return out;
  }

  // Appendices can follow the list; reading a couple of dozen pages past the heading covers any real bibliography.
  private lastReferencesPage(region: ReferencesRegion): number {
    return Math.min(this.pages.numPages, region.pageNumber + MAX_REFERENCE_PAGES);
  }

  private getRegion(): Promise<ReferencesRegion | null> {
    this.region ??= this.locate();
    return this.region;
  }

  private async locate(): Promise<ReferencesRegion | null> {
    const total = this.pages.numPages;
    const span = Math.min(MAX_SCAN_PAGES, Math.max(MIN_SCAN_PAGES, Math.ceil(total * SCAN_FRACTION)));
    const first = Math.max(1, total - span + 1);
    for (let p = total; p >= first; p--) {
      const { lines } = await this.pages.get(p);
      const idx = findReferencesStart(lines);
      if (idx >= 0) { return { pageNumber: p, headingLine: lines[idx]!, headingIndex: idx }; }
    }
    return null;
  }

  private async pageEntries(pageNumber: number): Promise<ReferenceEntry[]> {
    const cached = this.entries.get(pageNumber);
    if (cached) { return cached; }
    const region = await this.getRegion();
    const { lines } = await this.pages.get(pageNumber);
    const relevant = region && region.pageNumber === pageNumber ? lines.slice(region.headingIndex + 1) : lines;
    const entries = splitReferenceEntries(relevant);
    this.entries.set(pageNumber, entries);
    return entries;
  }
}

/**
 * Finds the figure, table or equation a textual reference ("Fig. 3", "Tabela 2", "Eq. (5)") points at, from captions in
 * the page text. This is what makes float previews work in PDFs without link annotations, scans with an OCR layer included.
 */

interface FloatMatch {
  pageNumber: number;
  region: PdfRegion;
  /** Baseline of the caption line, for jumping. */
  captionY: number;
}

interface IndexedCaption {
  kind: FloatKind;
  label: string;
  pageNumber: number;
  lineIndex: number;
}

// A monograph has thousands of lines; past this the index costs more than a float preview is worth.
const MAX_INDEXED_PAGES = 150;

export class FloatResolver {
  private index: Promise<IndexedCaption[]> | null = null;

  constructor(private readonly pages: PageTextCache) {}

  /**
   * Builds the caption index in the background so the first hover does not pay for it.
   */
  warmUp(): void {
    void this.getIndex();
  }

  /**
   * @returns where the float is, or null when no caption with that label exists.
   */
  async find(kind: FloatKind, label: string): Promise<FloatMatch | null> {
    const index = await this.getIndex();
    const at = pickCaption(index, kind, label);
    const hit = index[at];
    if (!hit) { return null; }
    const page = await this.pages.get(hit.pageNumber);
    const line = page.lines[hit.lineIndex];
    if (!line) { return null; }
    return {
      pageNumber: hit.pageNumber,
      region: deriveFloatRegion(page.lines, hit, page.width, page.height, page.columnSplit),
      captionY: line.y + line.height,
    };
  }

  private getIndex(): Promise<IndexedCaption[]> {
    this.index ??= this.build();
    return this.index;
  }

  private async build(): Promise<IndexedCaption[]> {
    const out: IndexedCaption[] = [];
    const last = Math.min(this.pages.numPages, MAX_INDEXED_PAGES);
    for (let pageNumber = 1; pageNumber <= last; pageNumber++) {
      try {
        const page = await this.pages.get(pageNumber);
        for (const hit of findCaptionLines(page.lines, page.width, page.columnSplit)) {
          // The first caption with a label wins: later "Figure 3" lines are continuations ("Figure 3 (continued)").
          if (!out.some((c) => c.kind === hit.kind && c.label === hit.label)) { out.push({ ...hit, pageNumber }); }
        }
      } catch {
        // A page whose text cannot be extracted simply contributes no captions.
      }
      // Yield between pages: this runs while the reader is reading.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }
    return out;
  }
}

/**
 * Extracts page text lazily and caches it per page: reading-order lines plus the column split. Shared by the citation and float
 * resolvers so a page is extracted and analysed once.
 */

export interface PageText {
  lines: TextLine[];
  columnSplit: number | null;
  width: number;
  height: number;
}

export class PageTextCache {
  private readonly pages = new Map<number, Promise<PageText>>();

  constructor(private readonly ctx: ReaderContext) {}

  get numPages(): number { return this.ctx.pdfDocument.numPages; }

  /**
   * @returns the page's text lines in reading order; extraction runs once per page.
   */
  get(pageNumber: number): Promise<PageText> {
    let promise = this.pages.get(pageNumber);
    if (!promise) {
      promise = this.extract(pageNumber);
      this.pages.set(pageNumber, promise);
    }
    return promise;
  }

  private async extract(pageNumber: number): Promise<PageText> {
    const page = await this.ctx.pdfDocument.getPage(pageNumber);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const all: TextItemBox[] = [];
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
      if (typeof it.str !== "string" || !it.transform) { continue; }
      all.push({
        str: it.str,
        x: it.transform[4] ?? 0,
        y: it.transform[5] ?? 0,
        width: it.width ?? 0,
        height: it.height || Math.abs(it.transform[3] ?? 0) || 10,
        orientation: runOrientation(it.transform),
      });
    }
    const items = deriveReadableItems(all, width);
    return { lines: deriveLinesFromItems(items, width), columnSplit: detectColumns(items, width), width, height };
  }
}
