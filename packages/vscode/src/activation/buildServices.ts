// Constructs and wires every application service for a given library root.
import * as vscode from "vscode";

import { LibraryStore, PaperDataStore, PdfImportParser, BibtexService, createLibraryLayout, scanLibrary, type MutationContext } from "@labshelf/core";
import { PaperImporter, PaperService, PaperTextLayers } from "../library/index.js";
import { ensureLibraryStructure } from "../storage/paths/index.js";
import { VscodeFileSystem } from "../storage/index.js";
import { queueTextLayers } from "../command/index.js";
import { reindexLibrary, type ReindexSummary } from "../storage/index.js";
import type { ActiveServices } from "../command/index.js";
import type { LibraryEvents } from "../library/index.js";
import type { ILogger } from "@labshelf/core";
import type { HostAdapters } from "./hostAdapters.js";

// The adapter belongs to one library root: its temp folder for atomic writes sits inside that root.
const createFileSystem = (root: vscode.Uri, adapters: Pick<HostAdapters, "paths" | "uriOf">): VscodeFileSystem =>
  new VscodeFileSystem(root.fsPath, adapters.paths, adapters.uriOf);

// textLayers is read lazily (through getTextLayers) because PaperService, which PaperTextLayers wraps, needs this
// same reindexer before it exists yet.
function createReindexer(
  store: LibraryStore,
  events: LibraryEvents,
  logger: ILogger,
  getTextLayers: () => PaperTextLayers,
): () => Promise<ReindexSummary> {
  return () => reindexLibrary({
    store,
    events,
    queueCheck: (papers) => void queueTextLayers(getTextLayers(), papers, { mode: "check", logger }),
  });
}

// Constructs and wires all application services for the given library root.
export async function buildServices(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  events: LibraryEvents,
  adapters: HostAdapters,
): Promise<ActiveServices> {
  const paths = createLibraryLayout(root, vscode.Uri.joinPath);
  const fileSystem = createFileSystem(root, adapters);
  await ensureLibraryStructure(root, fileSystem);
  const device = adapters.deviceLayout(root.fsPath);
  const logger = adapters.createLogger(device.appLogPath);
  const { ocr, textLayerBuilder } = adapters.createPdfTextServices(logger);
  const pdfImportParser = new PdfImportParser(adapters.pdfOpener, { ocr, logger });
  const bibTeXService = new BibtexService(fileSystem);
  const mutations: MutationContext = {
    fs: fileSystem, paths: adapters.paths, artifacts: bibTeXService, logger, papersRoot: paths.papersRoot().fsPath,
  };
  const parse = (bytes: Uint8Array, stem: string) => pdfImportParser.parse(bytes, stem);
  const papersRoot = paths.papersRoot().fsPath;
  const store = new LibraryStore({ root: papersRoot, scan: (previous) => scanLibrary(fileSystem, adapters.paths, papersRoot, logger, previous) });

  // textLayers is assigned right below, once paperService exists; the first reindex run is the seed call further
  // down, after every const in this function is assigned, so the forward reference is safe.
  let textLayers!: PaperTextLayers;
  const reindex = createReindexer(store, events, logger, () => textLayers);

  const paperService = new PaperService(mutations, store, reindex, events, parse);
  const network = {
    tmpDir: paths.tmpDir().fsPath,
    download: { fetch: globalThis.fetch, headers: { "User-Agent": `LabShelf-VSCode/${context.extension.packageJSON.version}` } },
  };
  const importer = new PaperImporter(mutations, store, reindex, parse, network);
  textLayers = new PaperTextLayers(mutations, paperService, textLayerBuilder);
  const paperDataStore = new PaperDataStore(adapters.createSidecarPort(createLibraryLayout(root.fsPath, adapters.paths.join), logger), { logger });

  // Seeds the store from disk. Nothing has subscribed to events for this root yet — the AI service, the
  // Library sidebar and the list panel all attach after buildServices returns — so the paper:added events this
  // first reindex fires are not seen by anyone.
  await reindex();

  return {
    paperService, importer, textLayers, mutations, logger, library: store, paperDataStore, fileSystem,
    reindexLibrary: reindex,
    aiDatabasePath: device.aiDatabasePath,
    citationCacheDir: device.openAlexCacheDir,
  };
}
