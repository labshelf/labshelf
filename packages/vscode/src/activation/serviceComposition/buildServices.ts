// Constructs and wires every application service for a given library root.
import * as path from "node:path";
import * as vscode from "vscode";

import { PaperDataStore, PdfImportParser, BibTeXService, libraryLayout, scanLibrary, type MutationContext } from "@labshelf/core";
import { NodePdfOpener, createNodeSidecarPort } from "@labshelf/core/node";
import { PaperImporter, PaperService, PaperTextLayers, createExtensionLogger } from "../../core/index.js";
import { ensureLibraryStructure } from "../../storage/paths/index.js";
import { VscodeFileSystem } from "../../storage/vscodeFileSystem.js";
import { createFolderReader } from "../../ui/library/index.js";
import { ThemeManager } from "../../pdf-viewer/index.js";
import { createOcrEngine, createTextLayerBuilder, hostPdfjs } from "../../pdf/index.js";
import { queueTextLayers } from "../../commands/textLayerQueue.js";
import { indexLibrary, reindexLibrary } from "../../storage/data/reindexLibrary.js";
import type { ActiveServices } from "../../commands/index.js";
import type { EventBus } from "../../events/index.js";
import { openLibraryDatabase } from "./openLibraryDatabase.js";

// The adapter belongs to one library root: its temp folder for atomic writes sits inside that root.
export const createFileSystem = (root: vscode.Uri): VscodeFileSystem =>
  new VscodeFileSystem(libraryLayout(root, vscode.Uri.joinPath).tmpDir().fsPath);

// Constructs and wires all application services for the given library root.
export async function buildServices(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  eventBus: EventBus,
): Promise<ActiveServices> {
  const paths = libraryLayout(root, vscode.Uri.joinPath);
  const fileSystem = createFileSystem(root);
  await ensureLibraryStructure(root, fileSystem);
  const database = await openLibraryDatabase(paths.indexPath(), fileSystem);
  const logger = createExtensionLogger(paths.appLogPath().fsPath, { append: (entry) => database.appendLog(entry) });
  const ocrEngine = createOcrEngine(context, logger);
  const pdfImportParser = new PdfImportParser(new NodePdfOpener(hostPdfjs), { ocr: ocrEngine });
  const bibTeXService = new BibTeXService(fileSystem);
  const mutations: MutationContext = {
    fs: fileSystem, paths: path, artifacts: bibTeXService, logger, papersRoot: paths.papersRoot().fsPath,
  };
  const parse = (bytes: Uint8Array, stem: string) => pdfImportParser.parse(bytes, stem);
  const paperService = new PaperService(mutations, database, eventBus, parse);
  const network = {
    tmpDir: paths.tmpDir().fsPath,
    download: { fetch: globalThis.fetch, headers: { "User-Agent": `LabShelf-VSCode/${context.extension.packageJSON.version}` } },
  };
  const importer = new PaperImporter(mutations, database, eventBus, parse, network);
  const textLayers = new PaperTextLayers(mutations, paperService, createTextLayerBuilder(ocrEngine));
  const paperDataStore = new PaperDataStore(createNodeSidecarPort(libraryLayout(root.fsPath, path.join), logger), { logger });
  const scan = () => scanLibrary(fileSystem, path, paths.papersRoot().fsPath, logger);
  await indexLibrary({ database, scan });
  // Papers imported before text layers were tracked are classified once, in the
  // background and without OCR; the verdict is saved in metadata.yaml. Papers
  // saved without a PDF have nothing to read and are left out.
  const indexed = await database.listPapers();
  const toCheck = indexed.filter((paper) => paper.hasPdf !== false && !paper.textLayer);
  if (toCheck.length > 0) {
    void queueTextLayers(textLayers, toCheck, { mode: "check", logger });
  }
  const themeManager = new ThemeManager();
  const reindex = () =>
    reindexLibrary({
      database,
      scan,
      eventBus,
      queueCheck: (papers) => void queueTextLayers(textLayers, papers, { mode: "check", logger }),
    });
  return {
    paperService, importer, textLayers, mutations, logger, themeManager, database, paperDataStore, fileSystem,
    reindexLibrary: reindex,
    folderReader: createFolderReader(fileSystem, logger),
  };
}
