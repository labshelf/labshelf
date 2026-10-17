// Builds the concrete adapters and wires the services for one library.
// INVARIANT: the TUI and the CLI both start here; nothing else instantiates adapters.
import * as path from "node:path";

import {
  BibTeXService, Logger, PdfImportParser, errorMessage,
  type ILogger, type LibraryStore, type PdfjsLoader,
} from "@labshelf/core";
import { FileLogSink, NodeLibraryFileSystem, NodePdfOpener, TesseractOcrEngine, cacheDir, createPdfjsLoader } from "@labshelf/core/node";

import type { TerminalConfig } from "./config.js";
import {
  LibraryRoot, LibraryWatcher, SidecarReader, TerminalPaperService, createLibraryStore, ensureLibraryStructure,
} from "../library/index.js";
import { moveToTrash } from "../platform/index.js";
import { defaultRenderer, ThumbnailService } from "../preview/index.js";
import { detectImageProtocol, type ImageProtocol } from "../tui/index.js";

export interface AppContext {
  paths: LibraryRoot;
  config: TerminalConfig;
  logger: ILogger;
  store: LibraryStore;
  /** The terminal's query language over the store; it also holds the annotation text that searches see. */
  papers: TerminalPaperService;
  sidecars: SidecarReader;
  thumbnails: ThumbnailService;
  thumbnailRenderer: string;
  imageProtocol: ImageProtocol;
  /** Resolves once highlights and notes are in the search index (one-shot CLI searches wait for it). */
  annotationsReady: Promise<void>;
  /** Stops watchers and releases the OCR engine. */
  dispose(): Promise<void>;
}

export interface OpenOptions {
  config: TerminalConfig;
  env?: NodeJS.ProcessEnv;
  /** Watch the library for changes made by other apps (the TUI does; one-shot CLI commands do not). */
  watch?: boolean;
  /** dist/thumbnailWorker.mjs, resolved by main from the bundle's location. */
  thumbnailWorkerUrl: URL;
}

/** Builds the OCR fallback for scans and broken-font PDFs; it shares the parser's pdf.js and caches language data. */
function createOcrEngine(env: NodeJS.ProcessEnv, pdfjs: PdfjsLoader, logger: ILogger): TesseractOcrEngine {
  return new TesseractOcrEngine({
    pdfjs,
    cachePath: path.join(cacheDir(env), "ocr-cache"),
    onDiagnostic: (message) => void logger.log("INFO", "ocr", message),
  });
}

function createPaperService(
  paths: LibraryRoot, store: LibraryStore, logger: ILogger, env: NodeJS.ProcessEnv,
): { papers: TerminalPaperService; ocr: TesseractOcrEngine } {
  const pdfjs = createPdfjsLoader();
  const ocr = createOcrEngine(env, pdfjs, logger);
  let parser: PdfImportParser | undefined;
  const papers = new TerminalPaperService({
    paths,
    store,
    bibtex: new BibTeXService(new NodeLibraryFileSystem(paths.layout.tmpDir())),
    logger,
    pdfParser: async () => {
      if (!parser) {
        parser = new PdfImportParser(new NodePdfOpener(pdfjs), { logger, ocr });
      }
      return parser;
    },
    trash: moveToTrash,
  });
  return { papers, ocr };
}

function createThumbnails(env: NodeJS.ProcessEnv, workerUrl: URL, logger: ILogger) {
  const renderer = defaultRenderer(path.join(cacheDir(env), "tmp"), workerUrl);
  return { renderer, thumbnails: new ThumbnailService(cacheDir(env), renderer.render, logger) };
}

function startWatcher(
  paths: LibraryRoot, store: LibraryStore, logger: ILogger, indexAnnotations: () => Promise<void>,
): LibraryWatcher {
  const watcher = new LibraryWatcher(paths, () => {
    void store.reload().then(() => void indexAnnotations());
  }, logger);
  watcher.start();
  return watcher;
}

/**
 * Opens a library: creates its folder structure if needed, scans it, and wires every service.
 * @returns the context
 */
export async function openLibrary(root: string, options: OpenOptions): Promise<AppContext> {
  const env = options.env ?? process.env;
  const paths = new LibraryRoot(root);
  await ensureLibraryStructure(paths);
  // The TUI owns the terminal, so the log file is the only channel and there is nowhere else to report a failure.
  const logger = new Logger([new FileLogSink(paths.layout.terminalLogPath())], { onSinkError: () => undefined });
  const store = createLibraryStore(paths, logger);
  await store.reload();

  const { papers, ocr } = createPaperService(paths, store, logger, env);

  const sidecars = new SidecarReader(paths, logger);
  const { thumbnails, renderer } = createThumbnails(env, options.thumbnailWorkerUrl, logger);
  const imageProtocol = detectImageProtocol(env, env["LABSHELF_IMAGES"] ?? options.config.terminal?.images ?? "auto");

  // Highlights and notes become searchable; refreshed in the background whenever the library changes.
  const indexAnnotations = (): Promise<void> =>
    sidecars.annotationIndex(store.snapshot.papers.keys()).then(
      (index) => store.setAnnotationText(index),
      (error: unknown) => logger.log("WARN", "terminal/app", "Annotation text not indexed for search", { message: errorMessage(error) }),
    );
  const annotationsReady = indexAnnotations();

  const watcher = options.watch ? startWatcher(paths, store, logger, indexAnnotations) : undefined;

  await logger.log("INFO", "terminal/app", "Library opened", {
    root: paths.root, papers: store.snapshot.papers.size, images: imageProtocol, renderer: renderer.name,
  });

  return {
    paths,
    config: options.config,
    logger,
    store,
    papers,
    sidecars,
    thumbnails,
    thumbnailRenderer: renderer.name,
    imageProtocol,
    annotationsReady,
    async dispose() {
      watcher?.stop();
      await ocr.dispose();
    },
  };
}
