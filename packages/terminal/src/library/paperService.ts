// Applies every library change the terminal makes, then reloads the store.
// TRAP: titles are never rewritten, because paper folders are named after them.
import * as path from "node:path";

import {
  createFolder,
  createDoiFinder,
  updatePaperTags,
  importNetworkInput,
  importPaths,
  METADATA_FILE,
  joinCitations,
  moveFolder,
  movePapers,
  renameFolder,
  resolveReferences,
  setPapersReadingStatus,
  moveFolderToTrash,
  movePapersToTrash,
  updatePaperFields,
  type BatchOutcome,
  type BibtexService,
  type DetectedIdentifier,
  type ILogger,
  type ImportDeps,
  type ImportOutcome,
  type ImportProgress,
  type LibraryStore,
  type MutationContext,
  type NetworkImportEnv,
  type PaperFieldsUpdate,
  type PaperRecord,
  type ReadingStatus,
  type PdfImportParser,
  type ResolvedMetadata,
} from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";

import type { LibraryRoot } from "./libraryRoot.js";
import { resolveHomePath } from "../platform/index.js";

interface SortedInputs {
  /** Absolute paths that exist: files, folders, or entries the import reports as skipped. */
  local: string[];
  network: string[];
}

/** @returns the non-blank inputs, local paths resolved against the working directory */
export async function orderImportInputs(ctx: MutationContext, inputs: string[]): Promise<SortedInputs> {
  const sorted: SortedInputs = { local: [], network: [] };
  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) { continue; }
    const local = path.resolve(resolveHomePath(input));
    if (await ctx.fs.exists(local)) { sorted.local.push(local); } else { sorted.network.push(input); }
  }
  return sorted;
}

const USER_AGENT = "LabShelf-Terminal/0.1";

export interface PaperServiceDeps {
  paths: LibraryRoot;
  store: LibraryStore;
  bibtex: BibtexService;
  logger: ILogger;
  /** Built lazily: loading pdfjs costs ~100 ms and most sessions never import. */
  pdfParser: () => Promise<PdfImportParser>;
  trash: (target: string) => Promise<unknown>;
  fetch?: typeof fetch;
  /** Network metadata lookups; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
  searchByTitle?: (title: string) => Promise<ResolvedMetadata | undefined>;
}

export class TerminalPaperService {
  private readonly ctx: MutationContext;
  private readonly network: NetworkImportEnv;

  constructor(private readonly deps: PaperServiceDeps) {
    this.ctx = {
      fs: new NodeLibraryFileSystem(deps.paths.layout.tmpDir(), deps.trash),
      paths: path,
      artifacts: deps.bibtex,
      logger: deps.logger,
      papersRoot: deps.paths.layout.papersRoot(),
    };
    this.network = {
      ctx: this.ctx,
      tmpDir: deps.paths.layout.tmpDir(),
      importDeps: () => this.importDeps(),
      records: () => this.records(),
      download: { fetch: deps.fetch ?? globalThis.fetch, headers: { "User-Agent": USER_AGENT } },
      ...(deps.resolveIdentifier ? { resolveIdentifier: deps.resolveIdentifier } : {}),
      ...(deps.searchByTitle ? { searchByTitle: deps.searchByTitle } : {}),
    };
  }

  private get paths(): LibraryRoot { return this.deps.paths; }

  private async changed(): Promise<void> {
    await this.deps.store.reload();
  }

  private records(): PaperRecord[] {
    return [...this.deps.store.snapshot.papers.values()].map((entry) => entry.record);
  }

  private importDeps(): ImportDeps {
    const papers = this.deps.store.snapshot.papers;
    return {
      parse: async (bytes, stem) => (await this.deps.pdfParser()).parse(bytes, stem),
      findByDoi: createDoiFinder(this.records()),
      takenIds: () => papers.keys(),
    };
  }

  // VS Code may have moved the paper since the last scan: rescan once and look again.
  private async folderOf(id: string): Promise<string | undefined> {
    const known = this.deps.store.paper(id)?.record.path;
    if (known && (await this.ctx.fs.exists(path.join(known, METADATA_FILE)))) { return known; }
    await this.deps.store.reload();
    return this.deps.store.paper(id)?.record.path;
  }

  private refs(ids: string[]): ReturnType<typeof resolveReferences> {
    return resolveReferences(ids, async (id) => {
      const folder = await this.folderOf(id);
      return folder ? { path: folder } : undefined;
    });
  }

  private async finish(outcome: BatchOutcome, missing: BatchOutcome["failed"]): Promise<BatchOutcome> {
    await this.changed();
    return { done: outcome.done, failed: [...missing, ...outcome.failed] };
  }

  /**
   * Changes reading status, tags and/or note of one paper.
   * @returns the updated record, or undefined when the paper is unknown
   */
  async updateFields(id: string, patch: PaperFieldsUpdate): Promise<PaperRecord | undefined> {
    const folder = await this.folderOf(id);
    const record = folder ? await updatePaperFields(this.ctx, folder, patch) : undefined;
    if (record) { await this.changed(); }
    return record;
  }

  /** @returns ids changed and failures */
  async setStatus(ids: string[], status: ReadingStatus): Promise<BatchOutcome> {
    const { refs, failed } = await this.refs(ids);
    return this.finish(await setPapersReadingStatus(this.ctx, refs, status), failed);
  }

  /** @returns ids changed and failures */
  async editTags(ids: string[], add: string[], remove: string[]): Promise<BatchOutcome> {
    const { refs, failed } = await this.refs(ids);
    return this.finish(await updatePaperTags(this.ctx, refs, add, remove), failed);
  }

  /** @returns ids moved and failures */
  async movePapers(ids: string[], targetRel: string): Promise<BatchOutcome> {
    const { refs, failed } = await this.refs(ids);
    return this.finish(await movePapers(this.ctx, refs, this.paths.collectionDir(targetRel)), failed);
  }

  /** @returns ids trashed and failures */
  async trashPapers(ids: string[]): Promise<BatchOutcome> {
    const { refs, failed } = await this.refs(ids);
    return this.finish(await movePapersToTrash(this.ctx, refs), failed);
  }

  /** @returns the new collection's path relative to papers/ */
  async createCollection(parentRel: string, name: string): Promise<string> {
    const dir = await createFolder(this.ctx, this.paths.collectionDir(parentRel), name);
    await this.changed();
    return this.paths.relativeCollection(dir);
  }

  /** @returns the collection's new path */
  async renameCollection(rel: string, newName: string): Promise<string> {
    const dir = await renameFolder(this.ctx, this.paths.collectionDir(rel), newName);
    await this.changed();
    return this.paths.relativeCollection(dir);
  }

  /** @returns the collection's new path */
  async moveCollection(rel: string, targetParentRel: string): Promise<string> {
    const dir = await moveFolder(this.ctx, this.paths.collectionDir(rel), this.paths.collectionDir(targetParentRel));
    await this.changed();
    return this.paths.relativeCollection(dir);
  }

  async trashCollection(rel: string): Promise<void> {
    await moveFolderToTrash(this.ctx, this.paths.collectionDir(rel));
    await this.changed();
  }

  /**
   * Imports whatever the user typed or passed on the command line: a PDF, a folder of PDFs (recursively), a PDF URL,
   * an article page or an identifier. Changes are announced once at the end.
   * @returns one outcome per PDF found, then per local path that is neither file nor folder, then per network input
   */
  async importAny(inputs: string[], targetRel: string, onProgress?: (progress: ImportProgress) => void): Promise<ImportOutcome[]> {
    const targetDir = this.paths.collectionDir(targetRel);
    const { local, network } = await orderImportInputs(this.ctx, inputs);
    const outcomes = await importPaths(this.ctx, this.importDeps(), local, targetDir, {
      onProgress: (progress) => onProgress?.({ ...progress, total: progress.total + network.length }),
    });
    // A network import checks for duplicates against the store, so the store must hold what the earlier items added.
    if (local.length) { await this.deps.store.reload(); }
    const pdfCount = outcomes.filter((outcome) => outcome.status !== "skipped").length;
    for (const [position, input] of network.entries()) {
      onProgress?.({ index: pdfCount + position + 1, total: pdfCount + network.length, input });
      outcomes.push(await importNetworkInput(this.network, input, targetDir));
      await this.deps.store.reload();
    }
    return outcomes;
  }

  /**
   * Imports the paper a DOI names under `citeKey` and reloads the store, so the next import's duplicate check sees it.
   * @returns what happened
   */
  async importDoi(doi: string, citeKey: string, targetRel = ""): Promise<ImportOutcome> {
    const outcome = await importNetworkInput(this.network, doi, this.paths.collectionDir(targetRel), { citeKey });
    await this.deps.store.reload();
    return outcome;
  }

  /**
   * BibTeX entries for papers, without the local file line (what VS Code's "Copy BibTeX" produces).
   * @returns the entries separated by blank lines
   */
  bibtexFor(records: PaperRecord[]): string {
    return joinCitations(records, "bibtex") + "\n";
  }
}
