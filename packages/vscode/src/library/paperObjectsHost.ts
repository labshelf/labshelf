// The "From paper…" port of the VS Code surfaces: the open library's papers and PDFs through its services, crops from the
// platform's PDF renderer, and the platform's equation port, arXiv cache and AI table reader. Rebuilt when the library changes.
import {
  createLibraryPaperObjects, createPaperFiles, type EquationPort, type ILogger, type OpenPaperPdf, type PageBox, type PaperObjectsPort, type PdfTextSource,
} from "@labshelf/core";
import type { ActiveServices } from "../command/index.js";
import { createEprintCache, userAgentFetch } from "../equations/equationPort.js";

/** How the platform opens a PDF and renders a region of it; the desktop's runs pdf.js on the native canvas. */
interface PaperPdfRenderer<D extends PdfTextSource> {
  open(bytes: Uint8Array): Promise<OpenPaperPdf<D>>;
  renderRegion(doc: D, page: number, box: PageBox): Promise<Uint8Array>;
}

export interface VsCodePaperObjectsDeps<D extends PdfTextSource> {
  /** The open library's services; undefined while no library is open. */
  services(): ActiveServices | undefined;
  /** The open library's folder, where the arXiv e-print cache lives. */
  root(): string | undefined;
  pdf: PaperPdfRenderer<D>;
  /** The platform's equation port over these services; equations are read from images only without it. */
  equationPort?(services: ActiveServices): EquationPort | undefined;
  /** The AI table reader, logging to the open library's log; tables are not read from an image without it. */
  tableVision?(logger: ILogger): (png: Uint8Array) => Promise<string | null>;
  /** The extension version, for the User-Agent arXiv sees. */
  version: string;
}

/** A port whose calls go to the port of the library open at the time; it fails with "No library is open." without one. */
export function createVsCodePaperObjects<D extends PdfTextSource>(deps: VsCodePaperObjectsDeps<D>): PaperObjectsPort {
  let built: { services: ActiveServices; port: PaperObjectsPort } | undefined;

  function build(services: ActiveServices): PaperObjectsPort {
    const { fileSystem: fs, paperService, mutations: { paths: { join } } } = services;
    const root = deps.root();
    const equation = deps.equationPort?.(services);
    return createLibraryPaperObjects<D>({
      records: () => paperService.listPapers(),
      record: (paperId) => paperService.findPaper(paperId),
      async openPdf(record) {
        const file = createPaperFiles(record.path, join).pdf;
        if (!(await fs.stat(file))?.isFile) { return null; }
        return deps.pdf.open(await fs.readFile(file));
      },
      renderRegion: (doc, page, box) => deps.pdf.renderRegion(doc, page, box),
      ...(equation ? { equationOf: () => equation } : {}),
      ...(root ? { eprint: { fetch: userAgentFetch(deps.version), cache: createEprintCache({ fs, join, root }) } } : {}),
      ...(deps.tableVision ? { tableVision: deps.tableVision(services.logger) } : {}),
      logger: services.logger,
    });
  }

  function current(): PaperObjectsPort {
    const services = deps.services();
    if (!services) { throw new Error("No library is open."); }
    if (built?.services !== services) { built = { services, port: build(services) }; }
    return built.port;
  }

  return {
    papers: async (query) => current().papers(query),
    list: async (paperId) => current().list(paperId),
    preview: async (paperId, object) => current().preview(paperId, object),
    insert: async (paperId, object, options) => current().insert(paperId, object, options),
  };
}
