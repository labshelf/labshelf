// The library page's "From paper…" port: library papers from the cached records, their PDFs through the vendored pdf.js,
// region crops on a canvas of this page, and the equation chain, arXiv TeX and AI table reader the reader page also uses.
import {
  PDF_FILE,
  arxivIdOfRecord,
  createAiVisionTableReader,
  findMainFile,
  flattenSource,
  isEmptyQuery,
  loadEprint,
  matchPaper,
  parseQuery,
  searchDoc,
  type AiCredentialStore,
  type EquationPort,
  type ILogger,
  type LibraryFileSystem,
  type PaperRecord,
} from "@labshelf/core";
import { createPaperObjectService, readPdfPages, type PageBox, type PaperChoice, type PaperObjectsPort, type PdfPageText } from "@labshelf/core/paperObjects";
import { pageRectToPdfRegion, renderRegionPng, type PdfPageLike } from "@labshelf/core/dom";
import type { ILatexHelper } from "@labshelf/core/helper";
import type * as Pdfjs from "pdfjs-dist";
import { loadPdfjs } from "../capture/pdfFinding";
import { createBrowserEquationPort, createEprintCache } from "../equations/equationPort";
import { listCachedPaperRecords, readCachedPaperRecord } from "../storage";

const MODULE = "browser.paperObjects";
/** The picker lists at most this many papers. */
const MAX_PAPERS = 50;
/** Papers whose PDF, equation port and arXiv TeX stay open; the least recently used beyond it is dropped. */
const OPEN_PAPERS = 4;
/** More than three authors show as "First et al.". */
const MAX_AUTHORS = 3;

export interface BrowserPaperObjectsDeps {
  fs: LibraryFileSystem;
  logger: ILogger;
  /** The page's LabShelf Helper, for pix2tex; equations skip pix2tex without it. */
  helper?: () => ILatexHelper;
  /** Opens the helper's setup when an install needs it. */
  openHelperSetup?: () => void;
  /** The AI keys of this browser, for equations and tables read from an image; without it no AI source is used. */
  credentials?: AiCredentialStore;
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

interface OpenPdf { task: Promise<Pdfjs.PDFDocumentLoadingTask>; doc: Promise<Pdfjs.PDFDocumentProxy> }

/** The "From paper…" port of the library page's note tabs. */
export function createBrowserPaperObjects(deps: BrowserPaperObjectsDeps): PaperObjectsPort {
  const { fs, logger, helper, openHelperSetup, credentials } = deps;
  const eprintCache = createEprintCache(fs);

  // INVARIANT: an evicted document is destroyed through its loading task, which also ends a load still running.
  const pdfs = createLru<OpenPdf>(OPEN_PAPERS, (open) => {
    void open.task.then((task) => task.destroy()).catch((error: unknown) => { void logger.error(MODULE, error, { step: "close pdf" }); });
  });
  const equationPorts = createLru<Promise<EquationPort>>(OPEN_PAPERS);
  const tex = createLru<Promise<string | null>>(OPEN_PAPERS);

  async function recordOf(paperId: string): Promise<PaperRecord> {
    const record = await readCachedPaperRecord(paperId);
    if (!record) throw new Error("That paper is not in the library.");
    return record;
  }

  function documentOf(paperId: string, record: PaperRecord): Promise<Pdfjs.PDFDocumentProxy> {
    const open = pdfs.get(paperId, () => {
      const task = (async () => {
        const [lib, bytes] = await Promise.all([loadPdfjs(), fs.readFile(`${record.path}/${PDF_FILE}`)]);
        // pdf.js transfers the buffer to its worker; it gets a private copy.
        return lib.getDocument({ data: bytes.slice() });
      })();
      return { task, doc: task.then((loading) => loading.promise) };
    });
    open.doc.catch(() => { pdfs.delete(paperId); });
    return open.doc;
  }

  async function pages(paperId: string): Promise<PdfPageText[] | null> {
    const record = await readCachedPaperRecord(paperId);
    if (!record || !(await fs.stat(`${record.path}/${PDF_FILE}`))?.isFile) return null;
    return readPdfPages(await documentOf(paperId, record));
  }

  async function render(paperId: string, pageNumber: number, box: PageBox): Promise<Uint8Array> {
    const doc = await documentOf(paperId, await recordOf(paperId));
    const page = (await doc.getPage(pageNumber)) as unknown as PdfPageLike;
    const region = pageRectToPdfRegion(box, page.getViewport({ scale: 1 }));
    // The crop's default size: three times the box at 100% zoom, like the reader's equation box, so an inserted image stays sharp.
    return renderRegionPng(page, region);
  }

  const equation: EquationPort = {
    async extract(request, onProgress, signal) {
      const port = await equationPorts.get(request.paperId, () => {
        const made = recordOf(request.paperId).then((paper) => createBrowserEquationPort({
          fs, paper, logger, ...(helper ? { helper } : {}), ...(openHelperSetup ? { openHelperSetup } : {}), ...(credentials ? { credentials } : {}),
        }));
        made.catch(() => { equationPorts.delete(request.paperId); });
        return made;
      });
      return port.extract(request, onProgress, signal);
    },
  };

  async function readEprintTex(paperId: string): Promise<string | null> {
    const record = await readCachedPaperRecord(paperId);
    const arxivId = record ? arxivIdOfRecord(record) : undefined;
    if (arxivId === undefined) return null;
    // INVARIANT: the global fetch is called as a bare function; as a method of another object it throws Illegal invocation.
    const files = await loadEprint(arxivId, { fetch: (url, init) => fetch(url, init), cache: eprintCache, logger });
    if (files.kind !== "tex") return null;
    const main = findMainFile(files.files);
    return main === undefined ? null : flattenSource(files.files, main);
  }

  return createPaperObjectService({
    papers: async (query) => rankPaperChoices(await listCachedPaperRecords(), query),
    async paperInfo(paperId) {
      const record = await readCachedPaperRecord(paperId);
      return record ? { citeKey: record.citeKey || null, title: record.title } : null;
    },
    pages,
    render,
    equation,
    eprintTex: (paperId) => {
      const read = tex.get(paperId, () => readEprintTex(paperId));
      read.catch(() => { tex.delete(paperId); });
      return read;
    },
    ...(credentials
      ? { tableVision: createAiVisionTableReader({ credentials, fetch: (url, init) => fetch(url, init), logger }) }
      : {}),
    logger,
  });
}
