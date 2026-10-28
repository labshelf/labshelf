/** Pairs citations with the library papers and highlights behind them: the quotable highlights of a paper, the entries of the reader's citation card, and which cite key a link of a compiled PDF stands for. */

import type { Annotation, AnnotationColor, PaperRecord } from "../../model/index.js";
import { PAPERS_DIR } from "../../library/index.js";
import type { CitationBibEntry, CitationEntry, CitationCardPaper, CitationQuery, CitingCommand, PageArea, PagePoint } from "../../reader/index.js";
import type { ProjectFormat } from "../project/index.js";
import { extractPlainField, readBibField, type BibEntry } from "./bibliography.js";
import { derivePapersByCiteKey, findCiteKeyOccurrences } from "./citeKeys.js";

// --- Quotable highlights ---

// A highlight without text cannot be quoted or recognised in a list.
export const listQuotableHighlights = (annotations: readonly Annotation[]): Annotation[] =>
  annotations.filter((annotation) => annotation.type === "highlight" && annotation.content.trim() !== "");

/** A highlight's text and the 1-based page it is on. */
export interface QuotedHighlight {
  text: string;
  page: number;
  color?: AnnotationColor;
}

/** @returns at most `limit` text-bearing highlights: those on `citedPage` first, then by page, then by creation within a page. */
export function listQuotedHighlights(annotations: readonly Annotation[], limit: number, citedPage?: number): QuotedHighlight[] {
  const onCitedPage = (a: Annotation): number => (a.pageNumber === citedPage ? 0 : 1);
  return annotations
    .filter((a) => a.type === "highlight" && a.content.trim() !== "")
    .sort((a, b) => onCitedPage(a) - onCitedPage(b) || a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit)
    .map((a) => ({ text: a.content.trim(), page: a.pageNumber, ...(a.color ? { color: a.color } : {}) }));
}

// --- Citation card entries ---

/** What the card shows beyond the library record: highlights by paper id; the rest by cite key. */
export interface CitationDetails {
  highlights?: ReadonlyMap<string, QuotedHighlight[]>;
  /** The `.bib` record of a key, shown only when no library paper has the key. */
  bib?: ReadonlyMap<string, CitationBibEntry>;
  /** The citing command at the queried place. */
  site?: ReadonlyMap<string, CitingCommand>;
  /** The page the citing command names. */
  citedPage?: ReadonlyMap<string, number>;
}

// A paper's path is `papers/<folder>/.../<id>`; a paper at the library root has no folder.
function folderOf(path: string): string | undefined {
  const parts = path.split("/");
  const folders = parts[0] === PAPERS_DIR ? parts.slice(1, -1) : [];
  return folders.length > 0 ? folders.join(" / ") : undefined;
}

function citedPaper(paper: PaperRecord, details: CitationDetails): CitationCardPaper {
  const highlights = details.highlights?.get(paper.id);
  const folder = folderOf(paper.path);
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors ?? [],
    status: paper.status,
    ...(paper.year !== undefined ? { year: paper.year } : {}),
    ...(paper.journal ? { venue: paper.journal } : {}),
    ...(folder ? { folder } : {}),
    ...(highlights ? { highlights } : {}),
  };
}

/** One entry per key, in the keys' order; a key no library paper has keeps an entry with its `.bib` record, if any. */
export function deriveCitationEntries(keys: readonly string[], papers: readonly PaperRecord[], details: CitationDetails = {}): CitationEntry[] {
  const library = derivePapersByCiteKey(papers);
  return [...new Set(keys)].map((key) => {
    const paper = library.get(key);
    const bib = paper ? undefined : details.bib?.get(key);
    const site = details.site?.get(key);
    const citedPage = details.citedPage?.get(key);
    return {
      key,
      ...(paper ? { paper: citedPaper(paper, details) } : {}),
      ...(bib ? { bib } : {}),
      ...(site ? { site } : {}),
      ...(citedPage !== undefined ? { citedPage } : {}),
    };
  });
}

const VENUE_FIELDS = ["journal", "journaltitle", "booktitle", "publisher"] as const;

/** A `.bib` record in the shape the citation card shows; fields the record lacks are left out. */
export function createBibliographyCardEntry(entry: BibEntry): CitationBibEntry {
  const title = readBibField(entry, "title");
  const authors = readBibField(entry, "author").split(/\s+and\s+/).filter((name) => name !== "");
  const year = Number(/\d{4}/.exec(extractPlainField(entry.fields.get("year") ?? entry.fields.get("date")))?.[0]);
  const venue = VENUE_FIELDS.map((field) => readBibField(entry, field)).find((value) => value !== "");
  return { authors, ...(title ? { title } : {}), ...(year ? { year } : {}), ...(venue ? { venue } : {}) };
}

// --- Cite keys behind a PDF ---

/** Where a Typst build placed one citation: its key and the top-left of its text. */
export interface TypstCitation {
  key: string;
  at: PagePoint;
}

// hyperref names the target of `\cite{key}` `cite.key`; biblatex adds the refsection, `cite.0@key`.
const HYPERREF_CITE = /^cite\.(?:\d+@)?(.+)$/;

/** The cite key of a hyperref destination name, or `undefined` for a destination that is not a citation. */
export function deriveCiteKey(dest: string): string | undefined {
  return HYPERREF_CITE.exec(dest)?.[1];
}

// Positions and link rectangles come from the same layout but through different rounding.
const SLACK = 1;

/** The key of the Typst citation whose text starts inside the area, e.g. the rectangle of a link. */
export function findTypstCitationAt(cites: readonly TypstCitation[], area: PageArea): string | undefined {
  const inside = (cite: TypstCitation): boolean =>
    cite.at.page === area.page
    && cite.at.x >= area.left - SLACK && cite.at.x <= area.right + SLACK
    && cite.at.y >= area.top - SLACK && cite.at.y <= area.bottom + SLACK;
  return cites.find(inside)?.key;
}

/** A source file's whole text and a 1-based line of it. */
export interface SourceLine {
  text: string;
  line: number;
}

/** What the host knows about the build behind the PDF. */
export interface CitationSources {
  format: ProjectFormat;
  /** Where the last Typst build placed each citation; absent when it is not known. */
  typstCites?: readonly TypstCitation[];
  /** The source line behind a point, through SyncTeX; `undefined` when there is no SyncTeX data or no source there. */
  sourceLineAt?(point: PagePoint): Promise<SourceLine | undefined>;
}

/** Every key cited on one line of a source file; the whole text is scanned so comments and offsets stay right. */
export function findCiteKeysOnLine(format: ProjectFormat, source: SourceLine): string[] {
  const lineStarts = [0];
  for (let i = source.text.indexOf("\n"); i !== -1; i = source.text.indexOf("\n", i + 1)) { lineStarts.push(i + 1); }
  const start = lineStarts[source.line - 1];
  if (start === undefined) { return []; }
  const end = lineStarts[source.line] ?? source.text.length + 1;
  const keys = findCiteKeyOccurrences(format, source.text).filter((cited) => cited.start >= start && cited.start < end).map((cited) => cited.key);
  return [...new Set(keys)];
}

/**
 * A named destination is read as hyperref's (`cite.<key>`); a Typst link is matched against the build's citation positions;
 * LaTeX text without a link, i.e. a build without hyperref, goes through SyncTeX to the `\cite` commands on its source line.
 */
export async function findCiteKeysAt(query: CitationQuery, sources: CitationSources): Promise<string[]> {
  if (query.dest !== undefined) {
    const key = deriveCiteKey(query.dest);
    return key === undefined ? [] : [key];
  }
  const { area } = query;
  if (sources.format === "typst") {
    const key = findTypstCitationAt(sources.typstCites ?? [], area);
    return key === undefined ? [] : [key];
  }
  // A LaTeX link without a destination name is not hyperref's citation link.
  if (query.link || !sources.sourceLineAt) { return []; }
  const center = { page: area.page, x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  const source = await sources.sourceLineAt(center);
  return source ? findCiteKeysOnLine("latex", source) : [];
}
