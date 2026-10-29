// Builds the concrete adapters and wires the services for one library.
// INVARIANT: the TUI and the CLI both start here; nothing else instantiates adapters.
import * as path from "node:path";

import {
  BibtexService, FileProjectVersionStore, Logger, PdfImportParser, formatError,
  applyChangeBatch, type ConflictCopy, type ConflictResolution, type ILogger, type LibraryStore, type PaperNotesStore, type PdfjsLoader,
} from "@labshelf/core";
import {
  FileLogSink, NodeLibraryFileSystem, NodePdfOpener, TesseractOcrEngine, resolveCacheDir, createPdfjsLoader,
  createProjectWriteTracking, createDeviceLocalLayout, resolveConflictCopy, resolveProjectConflictCopy, scanLibraryConflicts,
} from "@labshelf/core/node";

import type { TerminalConfig } from "./config.js";
import {
  ConflictFeed, LibraryRoot, LibraryWatcher, SidecarReader, TerminalPaperService, createLibraryStore, ensureLibraryStructure,
} from "./library/index.js";
import { moveToTrash } from "./platform/index.js";
import { createDefaultRenderer, ThumbnailService } from "./libraryUi/index.js";
import { detectImageProtocol, type ImageProtocol } from "./screen/index.js";

export interface AppContext {
  paths: LibraryRoot;
  config: TerminalConfig;
  logger: ILogger;
  /** The terminal log file, device-local. */
  logPath: string;
  store: LibraryStore;
  /** The terminal's query language over the store; it also holds the annotation text that searches see. */
  papers: TerminalPaperService;
  sidecars: SidecarReader;
  /** The papers' notes.qmd files. */
  notes: PaperNotesStore;
  /** Rebuilds the highlight and notes text that searches see (after notes.qmd was edited here). */
  indexSearchText(): Promise<void>;
  thumbnails: ThumbnailService;
  thumbnailRenderer: string;
  imageProtocol: ImageProtocol;
  /** Resolves once highlights and notes are in the search index (one-shot CLI searches wait for it). */
  annotationsReady: Promise<void>;
  /** The unresolved sync conflict copies, updated after every library scan. */
  conflicts: ConflictFeed;
  /** Scans for conflict copies now and updates `conflicts`. */
  rescanConflicts(): Promise<void>;
  resolveConflict(copy: ConflictCopy, resolution: ConflictResolution): Promise<void>;
  /** Calls the listener when the library folder disappears (unmounted drive, sync client). */
  onRootLost(listener: () => void): void;
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
    cachePath: path.join(resolveCacheDir(env), "ocr-cache"),
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
    bibtex: new BibtexService(new NodeLibraryFileSystem(paths.layout.tmpDir())),
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
  const renderer = createDefaultRenderer(path.join(resolveCacheDir(env), "tmp"), workerUrl);
  return { renderer, thumbnails: new ThumbnailService(resolveCacheDir(env), renderer.render, logger) };
}

function mergeBaseStore(root: string): FileProjectVersionStore {
  return new FileProjectVersionStore(new NodeLibraryFileSystem(), path, createDeviceLocalLayout(root).mergeBasesDir);
}

function startWatcher(
  paths: LibraryRoot, store: LibraryStore, logger: ILogger, conflicts: ConflictFeed,
  indexAnnotations: () => Promise<void>, onRootLost: () => void,
): LibraryWatcher {
  const watcher: LibraryWatcher = new LibraryWatcher(paths, () => {
    void applyChangeBatch({
      logger,
      isRootPresent: () => watcher.rootPresent(),
      scanConflicts: () => scanLibraryConflicts(paths.root, mergeBaseStore(paths.root), logger),
      onConflicts: (copies) => conflicts.set(copies),
      reindex: () => store.reload().then(() => void indexAnnotations()),
    });
  }, logger, onRootLost);
  watcher.start();
  return watcher;
}

// Highlights and notes.qmd text become searchable; refreshed in the background whenever the library changes.
function annotationIndexer(sidecars: SidecarReader, store: AppContext["store"], logger: ILogger): () => Promise<void> {
  const warn = (what: string) => (error: unknown) => logger.log("WARN", "terminal/app", `${what} not indexed for search`, { message: formatError(error) });
  return async () => {
    await Promise.all([
      sidecars.annotationIndex(store.snapshot.papers.keys()).then((index) => store.setAnnotationText(index), warn("Annotation text")),
      sidecars.notesIndex(store.snapshot.papers.keys()).then((index) => store.setNotesText(index), warn("Notes text")),
    ]);
  };
}

// Only a watched library scans at start, since nothing would keep an unwatched feed current.
async function openConflictFeed(
  root: string, logger: ILogger, scanAtStart: boolean | undefined,
): Promise<{ conflicts: ConflictFeed; rescanConflicts: () => Promise<void> }> {
  const conflicts = new ConflictFeed();
  const rescanConflicts = async (): Promise<void> => { conflicts.set(await scanLibraryConflicts(root, mergeBaseStore(root), logger)); };
  if (scanAtStart) {
    await rescanConflicts().catch((error: unknown) => logger.log("WARN", "terminal/app", "Startup conflict scan failed", { message: formatError(error) }));
  }
  return { conflicts, rescanConflicts };
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
  const logPath = createDeviceLocalLayout(paths.root, env).terminalLogPath;
  const logger = new Logger([new FileLogSink(logPath)], { onSinkError: () => undefined });
  const store = createLibraryStore(paths, logger);
  await store.reload();

  const { papers, ocr } = createPaperService(paths, store, logger, env);

  const sidecars = new SidecarReader(paths, logger);
  const { thumbnails, renderer } = createThumbnails(env, options.thumbnailWorkerUrl, logger);
  const imageProtocol = detectImageProtocol(env, env["LABSHELF_IMAGES"] ?? options.config.terminal?.images ?? "auto");

  const indexAnnotations = annotationIndexer(sidecars, store, logger);
  const annotationsReady = indexAnnotations();

  const { conflicts, rescanConflicts } = await openConflictFeed(paths.root, logger, options.watch);
  const rootLostListeners: Array<() => void> = [];
  const watcher = options.watch
    ? startWatcher(paths, store, logger, conflicts, indexAnnotations, () => rootLostListeners.forEach((listener) => listener()))
    : undefined;

  await logger.log("INFO", "terminal/app", "Library opened", {
    root: paths.root, papers: store.snapshot.papers.size, images: imageProtocol, renderer: renderer.name,
  });

  return {
    paths, config: options.config,
    logger, logPath,
    store, papers, sidecars, notes: sidecars.notes,
    indexSearchText: indexAnnotations,
    thumbnails,
    thumbnailRenderer: renderer.name,
    imageProtocol,
    annotationsReady,
    conflicts,
    rescanConflicts,
    resolveConflict: (copy, resolution) => resolution === "mergeAutomatically" || resolution === "notAVersion"
      ? resolveProjectConflictCopy(copy, resolution, { root: paths.root, store: mergeBaseStore(paths.root), logger })
      : resolveConflictCopy(copy, resolution, logger, createProjectWriteTracking(new NodeLibraryFileSystem(), () => paths.root, logger)),
    onRootLost: (listener) => { rootLostListeners.push(listener); },
    async dispose() {
      watcher?.stop();
      await ocr.dispose();
    },
  };
}
