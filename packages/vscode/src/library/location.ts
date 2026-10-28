/**
 * Locates the central LabShelf library: its root lives in the config file shared with the terminal app so both open
 * the same library; also moves a legacy globalState root there and reloads the library store from disk.
 */
import * as vscode from "vscode";

import { comparePapers, createLibraryLayout } from "@labshelf/core";
import type { IFileSystem, ILogger, LibraryStore, PaperRecord } from "@labshelf/core";
import type { LibraryEvents } from "./events.js";

/** The config file that stores the library root, shared with the terminal app so both open the same library. */
export interface SharedLibraryConfig {
  /** @returns the recorded library root, when there is one */
  readRoot(): Promise<string | undefined>;
  /** Records the root for every app; throws when the file cannot be written. */
  recordRoot(root: string, logger?: ILogger): Promise<void>;
  /** @returns where the file lives, for log context */
  path(): string;
}

/**
 * Reads the library root from the shared config and validates that it still exists on disk.
 * @returns URI of the library root, or undefined if unset or inaccessible
 */
export async function resolveLibraryRoot(sharedConfig: SharedLibraryConfig): Promise<vscode.Uri | undefined> {
  // CONTRACT: documents/contracts/library-format.md#shared-configuration
  const stored = await sharedConfig.readRoot();
  if (!stored) {
    return undefined;
  }

  const uri = vscode.Uri.file(stored);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.Directory) {
      return undefined;
    }
    return uri;
  } catch {
    // Path is not accessible
    return undefined;
  }
}

/**
 * Creates all required LabShelf subdirectories under root if they do not already exist.
 */
export async function ensureLibraryStructure(root: vscode.Uri, fileSystem: IFileSystem): Promise<void> {
  for (const dir of createLibraryLayout(root, vscode.Uri.joinPath).requiredDirs()) {
    await fileSystem.ensureDir(dir.fsPath);
  }
}

// Moves a library root stored in VS Code globalState into the shared config, once per install.
// Delete when no supported VS Code build predates the shared config.
const LIBRARY_ROOT_KEY = "labshelf.libraryRoot";
const MODULE = "storage";

/**
 * Copies a globalState-only root into the shared config, then clears the key. A root already in the shared config
 * wins. The key is cleared only after the shared config holds a root, so a failed write retries at the next start.
 * @param loggerFor builds the logger of the library the stored root points at
 * @returns the globalState root when the shared config could not take it, so this session still opens that library
 */
export async function moveLibraryRootToConfig(
  state: vscode.Memento,
  sharedConfig: SharedLibraryConfig,
  loggerFor: (root: string) => ILogger,
): Promise<string | undefined> {
  const stored = state.get<string>(LIBRARY_ROOT_KEY);
  if (!stored) { return undefined; }
  const logger = loggerFor(stored);
  const context = { file: sharedConfig.path(), globalStateRoot: stored };
  try {
    const sharedRoot = await sharedConfig.readRoot();
    if (sharedRoot === undefined) {
      await sharedConfig.recordRoot(stored, logger);
      await logger.log("INFO", MODULE, "Moved the library root into the shared config", { ...context, libraryRoot: stored });
    } else if (sharedRoot !== stored) {
      await logger.log("WARN", MODULE, "Kept the shared config's library root over a different globalState root", {
        ...context, sharedRoot,
      });
    }
    await state.update(LIBRARY_ROOT_KEY, undefined);
    return undefined;
  } catch (error) {
    await logger.error(MODULE, error, { ...context, action: "migrate library root", fallback: "open the globalState root this session" });
    return stored;
  }
}

// Reloads the library store from disk, diffs it against the previous state and emits paper events.
// Local mutations and external changes share this single reindex path; it lives outside extension.ts, which tests exclude.
export interface ReindexLibraryDeps {
  store: LibraryStore;
  events: LibraryEvents;
  // Queues a text-layer check for papers that have a PDF but no verdict.
  queueCheck?: (papers: PaperRecord[]) => void;
}

/** Ids whose records appeared, changed or disappeared during a reindex. */
export interface RefreshLibraryResult {
  added: string[];
  updated: string[];
  removed: string[];
}

function papersOf(store: LibraryStore): PaperRecord[] {
  return [...store.snapshot.papers.values()].map((entry) => entry.record);
}

/**
 * Reloads the store, then announces each change and queues the text-layer checks.
 * @returns the ids that were added, changed and removed
 */
export async function refreshLibrary(deps: ReindexLibraryDeps): Promise<RefreshLibraryResult> {
  const before = papersOf(deps.store);
  await deps.store.reload();
  const after = papersOf(deps.store);
  const diff = comparePapers(before, after);
  for (const paper of diff.added) { deps.events.paperAdded.fire(paper); }
  for (const paper of diff.updated) { deps.events.paperUpdated.fire(paper); }
  for (const paper of diff.removed) { deps.events.paperDeleted.fire({ id: paper.id }); }

  // A PDF that just arrived has no verdict yet, so let it be classified.
  const toCheck = [...diff.added, ...diff.gainedPdf].filter((paper) => paper.hasPdf !== false && !paper.textLayer);
  if (toCheck.length > 0) { deps.queueCheck?.(toCheck); }

  return {
    added: diff.added.map((paper) => paper.id),
    updated: diff.updated.map((paper) => paper.id),
    removed: diff.removed.map((paper) => paper.id),
  };
}
