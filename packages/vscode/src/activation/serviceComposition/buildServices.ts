// Constructs and wires every application service for a given library root.
import * as path from "node:path";
import * as vscode from "vscode";

import { LibraryStore, PaperDataStore, PdfImportParser, BibTeXService, libraryLayout, scanLibrary, type MutationContext } from "@labshelf/core";
import { NodePdfOpener, createNodeSidecarPort } from "@labshelf/core/node";
import { PaperImporter, PaperService, PaperTextLayers, createExtensionLogger } from "../../core/index.js";
import { ensureLibraryStructure } from "../../storage/paths/index.js";
import { VscodeFileSystem } from "../../storage/vscodeFileSystem.js";
import { createFolderReader } from "../../ui/library/index.js";
import { ThemeManager } from "../../pdf-viewer/index.js";
import { createOcrEngine, createTextLayerBuilder, hostPdfjs } from "../../pdf/index.js";
import { queueTextLayers } from "../../commands/textLayerQueue.js";
import { reindexLibrary, type ReindexSummary } from "../../storage/data/reindexLibrary.js";
import type { ActiveServices } from "../../commands/index.js";
import type { EventBus } from "../../events/index.js";
import type { ILogger } from "@labshelf/core";

// The adapter belongs to one library root: its temp folder for atomic writes sits inside that root.
export const createFileSystem = (root: vscode.Uri): VscodeFileSystem =>
  new VscodeFileSystem(libraryLayout(root, vscode.Uri.joinPath).tmpDir().fsPath);

// textLayers is read lazily (through getTextLayers) because PaperService, which PaperTextLayers wraps, needs this
// same reindexer before it exists yet.
function createReindexer(
  store: LibraryStore,
  eventBus: EventBus,
  logger: ILogger,
  getTextLayers: () => PaperTextLayers,
): () => Promise<ReindexSummary> {
  return () => reindexLibrary({
    store,
    eventBus,
    queueCheck: (papers) => void queueTextLayers(getTextLayers(), papers, { mode: "check", logger }),
  });
}

// Constructs and wires all application services for the given library root.
export async function buildServices(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  eventBus: EventBus,
): Promise<ActiveServices> {
  const paths = libraryLayout(root, vscode.Uri.joinPath);
  const fileSystem = createFileSystem(root);
  await ensureLibraryStructure(root, fileSystem);
  const logger = createExtensionLogger(paths.appLogPath().fsPath);
  const ocrEngine = createOcrEngine(context, logger);
  const pdfImportParser = new PdfImportParser(new NodePdfOpener(hostPdfjs), { ocr: ocrEngine });
  const bibTeXService = new BibTeXService(fileSystem);
  const mutations: MutationContext = {
    fs: fileSystem, paths: path, artifacts: bibTeXService, logger, papersRoot: paths.papersRoot().fsPath,
  };
  const parse = (bytes: Uint8Array, stem: string) => pdfImportParser.parse(bytes, stem);
  const scan = () => scanLibrary(fileSystem, path, paths.papersRoot().fsPath, logger);
  const store = new LibraryStore({ root: paths.papersRoot().fsPath, scan, filterFor: () => undefined });

  // textLayers is assigned right below, once paperService exists; the first reindex run is the seed call further
  // down, after every const in this function is assigned, so the forward reference is safe.
  let textLayers!: PaperTextLayers;
  const reindex = createReindexer(store, eventBus, logger, () => textLayers);

  const paperService = new PaperService(mutations, store, reindex, eventBus, parse);
  const network = {
    tmpDir: paths.tmpDir().fsPath,
    download: { fetch: globalThis.fetch, headers: { "User-Agent": `LabShelf-VSCode/${context.extension.packageJSON.version}` } },
  };
  const importer = new PaperImporter(mutations, store, reindex, parse, network);
  textLayers = new PaperTextLayers(mutations, paperService, createTextLayerBuilder(ocrEngine));
  const paperDataStore = new PaperDataStore(createNodeSidecarPort(libraryLayout(root.fsPath, path.join), logger), { logger });

  // Seeds the store from disk. Nothing has subscribed to eventBus for this root yet — the AI service, the
  // library tree and the list panel all attach after buildServices returns — so the paper:added events this
  // first reindex fires are not seen by anyone.
  await reindex();

  const themeManager = new ThemeManager();
  return {
    paperService, importer, textLayers, mutations, logger, themeManager, library: store, paperDataStore, fileSystem,
    reindexLibrary: reindex,
    aiDatabasePath: paths.indexPath().fsPath,
    folderReader: createFolderReader(fileSystem, logger),
  };
}
