// Builds the concrete adapters and wires the services for one library.
// INVARIANT: the TUI and the CLI both start here; nothing else instantiates adapters.
import * as path from "node:path";

import { BibTeXService, Logger, PdfImportParser, type ILogger, type LibraryStore, type SyncCoordinator } from "@labshelf/core";
import { FileLogSink, NodeFileSystem, NodePdfOpener, createPdfjsLoader } from "@labshelf/core/node";

import type { TerminalConfig } from "./config.js";
import {
  LibraryRoot, LibraryWatcher, PaperSearchIndex, SidecarReader, TerminalPaperService, createLibraryStore, ensureLibraryStructure,
} from "../library/index.js";
import { cacheDir, moveToTrash, openExternal } from "../platform/index.js";
import { defaultRenderer, ThumbnailService } from "../preview/index.js";
import { createTerminalAuth, createTerminalSync, createTokenStore, DriveAccount, resolveTerminalOAuthClient } from "../sync/index.js";
import { detectImageProtocol, type ImageProtocol } from "../tui/index.js";

export interface AppContext {
  paths: LibraryRoot;
  config: TerminalConfig;
  logger: ILogger;
  store: LibraryStore;
  /** The terminal's query language over the store; it also holds the annotation text that searches see. */
  search: PaperSearchIndex;
  papers: TerminalPaperService;
  sidecars: SidecarReader;
  sync: SyncCoordinator;
  drive: DriveAccount;
  thumbnails: ThumbnailService;
  thumbnailRenderer: string;
  imageProtocol: ImageProtocol;
  /** Resolves once highlights and notes are in the search index (one-shot CLI searches wait for it). */
  annotationsReady: Promise<void>;
  /** Stops watchers and timers; resolves after an in-flight sync finished. */
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

async function openSync(paths: LibraryRoot, store: LibraryStore, logger: ILogger, env: NodeJS.ProcessEnv) {
  const auth = createTerminalAuth(resolveTerminalOAuthClient(env), createTokenStore(env), logger, {
    openBrowser: (url) => openExternal(url),
  });
  const sync = createTerminalSync({ paths, auth, store, logger });
  await sync.init();
  return { sync, drive: new DriveAccount(auth, sync, logger) };
}

function createPaperService(paths: LibraryRoot, store: LibraryStore, logger: ILogger, sync: SyncCoordinator): TerminalPaperService {
  let parser: PdfImportParser | undefined;
  return new TerminalPaperService({
    paths,
    store,
    bibtex: new BibTeXService(new NodeFileSystem(paths.layout.tmpDir())),
    logger,
    pdfParser: async () => {
      if (!parser) {
        parser = new PdfImportParser(new NodePdfOpener(createPdfjsLoader()));
      }
      return parser;
    },
    trash: moveToTrash,
    onLocalChange: () => sync.scheduleLocalChange(),
  });
}

function createThumbnails(env: NodeJS.ProcessEnv, workerUrl: URL, logger: ILogger) {
  const renderer = defaultRenderer(path.join(cacheDir(env), "tmp"), workerUrl);
  return { renderer, thumbnails: new ThumbnailService(cacheDir(env), renderer.render, logger) };
}

function startWatcher(
  paths: LibraryRoot, store: LibraryStore, sync: SyncCoordinator, logger: ILogger, indexAnnotations: () => Promise<void>,
): LibraryWatcher {
  const watcher = new LibraryWatcher(paths, () => {
    void store.reload().then(() => {
      void indexAnnotations();
      void sync.refreshLastRun();
    });
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
  const search = new PaperSearchIndex();
  const store = createLibraryStore(paths, logger, search);
  await store.reload();

  const { sync, drive } = await openSync(paths, store, logger, env);
  const papers = createPaperService(paths, store, logger, sync);

  const sidecars = new SidecarReader(paths, logger);
  const { thumbnails, renderer } = createThumbnails(env, options.thumbnailWorkerUrl, logger);
  const imageProtocol = detectImageProtocol(env, env["LABSHELF_IMAGES"] ?? options.config.terminal?.images ?? "auto");

  // Highlights and notes become searchable; refreshed in the background whenever the library changes.
  const indexAnnotations = (): Promise<void> =>
    sidecars.annotationIndex(store.snapshot.papers.keys()).then((index) => search.setAnnotationText(index), () => undefined);
  const annotationsReady = indexAnnotations();

  const watcher = options.watch ? startWatcher(paths, store, sync, logger, indexAnnotations) : undefined;

  await logger.log("INFO", "terminal/app", "Library opened", {
    root: paths.root, papers: store.snapshot.papers.size, sync: sync.status().state, images: imageProtocol, renderer: renderer.name,
  });

  return {
    paths,
    config: options.config,
    logger,
    store,
    search,
    papers,
    sidecars,
    sync,
    drive,
    thumbnails,
    thumbnailRenderer: renderer.name,
    imageProtocol,
    annotationsReady,
    async dispose() {
      watcher?.stop();
      const pending = sync.stop();
      if (pending) { await pending.catch(() => undefined); }
    },
  };
}
