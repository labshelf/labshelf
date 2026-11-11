// The library page's "From paper…" port: library papers from the cached records, their PDFs through the vendored pdf.js,
// region crops on a canvas of this page, and the equation chain, arXiv TeX and AI table reader the reader page also uses.
import {
  PDF_FILE,
  createAiVisionTableReader,
  type AiCredentialStore,
  type ILogger,
  type LibraryFileSystem,
} from "@labshelf/core";
import { createLibraryPaperObjects, type PaperObjectsPort } from "@labshelf/core/paperObjects";
import { pageRectToPdfRegion, renderRegionPng, type PdfPageLike } from "@labshelf/core/dom";
import type { ILatexHelper } from "@labshelf/core/helper";
import type * as Pdfjs from "pdfjs-dist";
import { loadPdfjs } from "../capture/pdfFinding";
import { createBrowserEquationPort, createEprintCache } from "../equations/equationPort";
import { listCachedPaperRecords, readCachedPaperRecord } from "../storage";

export interface BrowserPaperObjectsDeps {
  fs: LibraryFileSystem;
  logger: ILogger;
  /** The page's LabShelf Helper, for pix2tex; equations skip pix2tex without it. */
  helper?: () => ILatexHelper;
  /** Opens the helper's setup when an install needs it. */
  openHelperSetup?: () => void;
  /** The AI keys of this browser, for equations and tables read from an image; without it no AI source is used. */
  credentials?: AiCredentialStore;
  /** Loads pdf.js; a page that already loaded it with its own worker (the reader) passes its loader. Default: `loadPdfjs`. */
  loadPdfjs?: () => Promise<typeof Pdfjs>;
}

/** The "From paper…" port of the library page's note tabs. */
export function createBrowserPaperObjects(deps: BrowserPaperObjectsDeps): PaperObjectsPort {
  const { fs, logger, helper, openHelperSetup, credentials, loadPdfjs: loadLib = loadPdfjs } = deps;
  return createLibraryPaperObjects<Pdfjs.PDFDocumentProxy>({
    records: listCachedPaperRecords,
    record: readCachedPaperRecord,
    async openPdf(record) {
      const file = `${record.path}/${PDF_FILE}`;
      if (!(await fs.stat(file))?.isFile) return null;
      const [lib, bytes] = await Promise.all([loadLib(), fs.readFile(file)]);
      // pdf.js transfers the buffer to its worker; it gets a private copy.
      const task = lib.getDocument({ data: bytes.slice() });
      return { doc: await task.promise, close: () => task.destroy() };
    },
    async renderRegion(doc, pageNumber, box) {
      const page = (await doc.getPage(pageNumber)) as unknown as PdfPageLike;
      // The crop's default size: three times the box at 100% zoom, like the reader's equation box, so an inserted image stays sharp.
      return renderRegionPng(page, pageRectToPdfRegion(box, page.getViewport({ scale: 1 })));
    },
    equationOf: (paper) => createBrowserEquationPort({
      fs, paper, logger, ...(helper ? { helper } : {}), ...(openHelperSetup ? { openHelperSetup } : {}), ...(credentials ? { credentials } : {}),
    }),
    // INVARIANT: the global fetch is called as a bare function; as a method of another object it throws Illegal invocation.
    eprint: { fetch: (url, init) => fetch(url, init), cache: createEprintCache(fs) },
    ...(credentials
      ? { tableVision: createAiVisionTableReader({ credentials, fetch: (url, init) => fetch(url, init), logger }) }
      : {}),
    logger,
  });
}
