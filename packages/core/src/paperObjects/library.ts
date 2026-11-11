// Composes a library's "From paper…" port: the papers the picker offers, one open PDF per recently used paper, and the
// equation chain, arXiv TeX and AI table reader a host supplies. Hosts differ only in how a PDF opens and a region renders.
import { findMainFile, flattenSource } from "../equations/flatten.js";
import { loadEprint, type EprintCache } from "../equations/arxivSource.js";
import { arxivIdOfRecord } from "../import/identifiers/arxiv.js";
import { isEmptyQuery, matchPaper, parseQuery, searchDoc } from "../library/search.js";
import type { PaperRecord } from "../model/index.js";
import type { FetchLike, ILogger } from "../ports/index.js";
import type { EquationPort } from "../reader/hostPorts.js";
import { readPdfPages, type PdfTextSource } from "./list.js";
import { createPaperObjectService } from "./service.js";
import type { PageBox, PaperChoice, PaperObjectsPort } from "./types.js";

const MODULE = "paperObjects/library";
/** The picker lists at most this many papers. */
const MAX_PAPERS = 50;
/** Papers whose PDF, equation port and arXiv TeX stay open; the least recently used beyond it is dropped. */
const OPEN_PAPERS = 4;
/** More than three authors show as "First et al.". */
const MAX_AUTHORS = 3;

/** A PDF a host opened, and how to close it again. */
export interface OpenPaperPdf<D> { doc: D; close(): Promise<void> }

export interface LibraryPaperObjectsDeps<D extends PdfTextSource> {
  /** Every paper of the library. */
  records(): Promise<readonly PaperRecord[]>;
  /** One paper of the library; undefined for an unknown id. */
  record(paperId: string): Promise<PaperRecord | undefined>;
  /** Opens the paper's PDF; null when it has none. */
  openPdf(record: PaperRecord): Promise<OpenPaperPdf<D> | null>;
  /** A PNG of `box` (page fractions from the top-left) on 1-based `page` of an open document, black on white. */
  renderRegion(doc: D, page: number, box: PageBox): Promise<Uint8Array>;
  /** The equation port for one paper, built once per recently used paper; equations are read from images only without it. */
  equationOf?(record: PaperRecord): EquationPort | Promise<EquationPort>;
  /** Where arXiv sources are fetched and cached; tables are not read from TeX without it. */
  eprint?: { fetch: FetchLike; cache: EprintCache };
  tableVision?: (png: Uint8Array) => Promise<string | null>;
  logger: ILogger;
}

/** A map that keeps the `limit` most recently used entries and hands each dropped value to `drop`. */
function createLru<V>(limit: number, drop: (value: V) => void = () => undefined) {
  const entries = new Map<string, V>();
  return {
    get(key: string, make: () => V): V {
      const found = entries.get(key);
      if (found !== undefined) {
        entries.delete(key);
        entries.set(key, found);
        return found;
      }
      const made = make();
      entries.set(key, made);
      for (const [oldest, value] of entries) {
        if (entries.size <= limit) break;
        entries.delete(oldest);
        drop(value);
      }
      return made;
    },
    delete(key: string): void { entries.delete(key); },
  };
}

/** "A, B, C", or "A et al." beyond three authors. */
function formatAuthors(authors: readonly string[] | undefined): string {
  const list = authors ?? [];
  return list.length > MAX_AUTHORS ? `${list[0]} et al.` : list.join(", ");
}

function toChoice(record: PaperRecord): PaperChoice {
  return {
    id: record.id,
    citeKey: record.citeKey || null,
    title: record.title,
    authors: formatAuthors(record.authors),
    year: record.year === undefined ? null : String(record.year),
  };
}

/** Most recently touched first (the status change is the only date a record keeps), then the newest year, then the title. */
function compareRecent(a: PaperRecord, b: PaperRecord): number {
  return (b.statusChangedAt ?? "").localeCompare(a.statusChangedAt ?? "")
    || (b.year ?? 0) - (a.year ?? 0)
    || a.title.localeCompare(b.title);
}

/**
 * The library papers matching `query` with the library's search syntax, best first; an empty query lists the most recently touched ones.
 * Trashed papers are never offered.
 */
export function rankPaperChoices(records: readonly PaperRecord[], query: string): PaperChoice[] {
  const live = records.filter((record) => !record.trashedAt);
  const parsed = parseQuery(query);
  if (isEmptyQuery(parsed)) return [...live].sort(compareRecent).slice(0, MAX_PAPERS).map(toChoice);
  return live
    .map((record) => ({ record, score: matchPaper(record, searchDoc(record), parsed) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || compareRecent(a.record, b.record))
    .slice(0, MAX_PAPERS)
    .map((hit) => toChoice(hit.record));
}

/** Caches a promise per paper among the recently used ones; a rejected promise is dropped so the next call retries. */
function cachedPerPaper<V>(make: (paperId: string) => Promise<V>, drop?: (value: Promise<V>) => void): (paperId: string) => Promise<V> {
  const cache = createLru<Promise<V>>(OPEN_PAPERS, drop);
  return (paperId) => {
    const value = cache.get(paperId, () => make(paperId));
    value.catch(() => { cache.delete(paperId); });
    return value;
  };
}

/** The "From paper…" port over one library: the composition the browser and VS Code share. */
export function createLibraryPaperObjects<D extends PdfTextSource>(deps: LibraryPaperObjectsDeps<D>): PaperObjectsPort {
  const { logger } = deps;

  async function recordOf(paperId: string): Promise<PaperRecord> {
    const record = await deps.record(paperId);
    if (!record) throw new Error("That paper is not in the library.");
    return record;
  }

  // INVARIANT: an evicted document is closed, which also ends a load still running.
  const pdfOf = cachedPerPaper(async (paperId) => deps.openPdf(await recordOf(paperId)), (open) => {
    void open.then((pdf) => pdf?.close()).catch((error: unknown) => { void logger.error(MODULE, error, { step: "close pdf" }); });
  });

  async function documentOf(paperId: string): Promise<D> {
    const pdf = await pdfOf(paperId);
    if (pdf === null) throw new Error("This paper has no PDF.");
    return pdf.doc;
  }

  const equationOf = deps.equationOf;
  const equationPortOf = equationOf ? cachedPerPaper(async (paperId) => equationOf(await recordOf(paperId))) : undefined;
  const equation: EquationPort | undefined = equationPortOf
    ? { extract: async (request, onProgress, signal) => (await equationPortOf(request.paperId)).extract(request, onProgress, signal) }
    : undefined;

  const eprint = deps.eprint;
  const eprintTex = eprint ? cachedPerPaper(async (paperId): Promise<string | null> => {
    const record = await deps.record(paperId);
    const arxivId = record ? arxivIdOfRecord(record) : undefined;
    if (arxivId === undefined) return null;
    const files = await loadEprint(arxivId, { fetch: eprint.fetch, cache: eprint.cache, logger });
    if (files.kind !== "tex") return null;
    const main = findMainFile(files.files);
    return main === undefined ? null : flattenSource(files.files, main);
  }) : undefined;

  return createPaperObjectService({
    papers: async (query) => rankPaperChoices(await deps.records(), query),
    async paperInfo(paperId) {
      const record = await deps.record(paperId);
      return record ? { citeKey: record.citeKey || null, title: record.title } : null;
    },
    async pages(paperId) {
      if (!(await deps.record(paperId))) return null;
      const pdf = await pdfOf(paperId);
      return pdf === null ? null : readPdfPages(pdf.doc);
    },
    render: async (paperId, page, box) => deps.renderRegion(await documentOf(paperId), page, box),
    ...(equation ? { equation } : {}),
    ...(eprintTex ? { eprintTex } : {}),
    ...(deps.tableVision ? { tableVision: deps.tableVision } : {}),
    logger,
  });
}
