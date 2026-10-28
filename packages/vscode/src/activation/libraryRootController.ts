// Owns the active library root and its built services, rebuilding both through one path whether the root
// comes from the first-run question, a move or a saved setting.
import * as vscode from "vscode";

import { LibraryStore, PaperService, PaperSidecarStore, PdfImportParser, BibtexService, createLibraryLayout, scanLibrary, type MutationContext } from "@labshelf/core";
import type { ILogger } from "@labshelf/core";
import { PaperImporter, PaperTextLayers, VscodeFileSystem, ensureLibraryStructure, pdfFileExists, refreshLibrary, type LibraryEvents, type RefreshLibraryResult } from "../library/index.js";
import { addTextLayerJobs } from "../command/index.js";
import type { ActiveServices } from "../command/index.js";
import { type HostAdapters } from "./hostAdapters.js";
import { ExternalChangeHandling } from "./externalChangeHandling.js";

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
): () => Promise<RefreshLibraryResult> {
  return () => refreshLibrary({
    store,
    events,
    queueCheck: (papers) => void addTextLayerJobs(getTextLayers(), papers, { mode: "check", logger }),
  });
}

// Constructs and wires all application services for the given library root.
async function buildServices(
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

  const paperService = new PaperService(mutations, store, reindex, events, parse, pdfFileExists);
  const network = {
    tmpDir: paths.tmpDir().fsPath,
    download: { fetch: globalThis.fetch, headers: { "User-Agent": `LabShelf-VSCode/${context.extension.packageJSON.version}` } },
  };
  const importer = new PaperImporter(mutations, store, reindex, parse, network);
  textLayers = new PaperTextLayers(mutations, paperService, textLayerBuilder);
  const paperDataStore = new PaperSidecarStore(adapters.createSidecarPort(createLibraryLayout(root.fsPath, adapters.paths.join), logger), { logger });

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

export interface LibraryRootChange {
  root: vscode.Uri;
  services: ActiveServices;
}

export class LibraryRootController {
  private root: vscode.Uri | undefined;
  private activeServices: ActiveServices | null = null;
  private readonly changeEmitter = new vscode.EventEmitter<LibraryRootChange>();
  readonly onDidChangeRoot = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly events: LibraryEvents,
    private readonly externalChangeHandling: ExternalChangeHandling,
    private readonly adapters: HostAdapters,
    private readonly chooseRoot: () => Promise<vscode.Uri | undefined>,
    private readonly build: typeof buildServices = buildServices,
  ) {
    context.subscriptions.push(this.changeEmitter);
  }

  currentRoot(): vscode.Uri | undefined {
    return this.root;
  }

  currentServices(): ActiveServices | null {
    return this.activeServices;
  }

  // Returns the current services or asks where the library lives and builds services from the answer.
  async require(): Promise<ActiveServices | null> {
    return this.activeServices ?? this.reconfigure();
  }

  // Always asks where the library lives, even when a library is already configured.
  async reconfigure(): Promise<ActiveServices | null> {
    const root = await this.chooseRoot();
    return root ? this.applyRoot(root) : null;
  }

  // The single place that builds services for a root and wires everything that follows it:
  // the Library sidebar (via onDidChangeRoot), the external-change watcher.
  async applyRoot(root: vscode.Uri): Promise<ActiveServices> {
    const services = await this.build(this.context, root, this.events, this.adapters);
    this.root = root;
    this.activeServices = services;
    this.changeEmitter.fire({ root, services });
    this.externalChangeHandling.watch(root);
    return services;
  }
}
