/**
 * Declares what the list panel needs from the extension: the paper service, events, the library root, the library snapshot and
 * folder changes, OCR jobs, reader sidecars and the AI index.
 */
import type * as vscode from 'vscode';
import type { Annotation, ILogger, LibrarySnapshot, PaperRecord, PathOps, SimilarPaper, TextLayerJobView } from '@labshelf/core';
import type { PaperService } from '../../core/index.js';
import type { LibraryEvents } from '../../events/index.js';
import type { LibraryNode } from '../library/index.js';

/** The slice of a paper's reader sidecar the panel reads. */
interface PaperSidecar {
  annotations: Annotation[];
  reading?: { page: number; updatedAt: string };
}

/** Folder changes, each of which refreshes the views itself and throws when it fails. */
interface ListFolderActions {
  create(parentDir: string, name: string): Promise<void>;
  rename(dir: string, name: string): Promise<void>;
  trash(dir: string): Promise<void>;
}

export interface ListPanelDeps {
  extensionUri: vscode.Uri;
  paperService: PaperService;
  events: LibraryEvents;
  logger: ILogger;
  pathOps: PathOps;
  /** Absolute path of papers/, or null while no library is configured. */
  getPapersRoot: () => string | null;
  /** The library's current snapshot, whose collections are the folder tree. */
  getSnapshot: () => LibrarySnapshot;
  folders: ListFolderActions;
  /** Called whenever the panel shows a different folder, so the sidebar tree can follow. */
  onDidNavigate?: (folder: LibraryNode) => void;
  /** Papers waiting for or undergoing OCR, shown on their rows while it runs. */
  textLayerJobs?: {
    current: () => TextLayerJobView[];
    onDidChange: (listener: (jobs: TextLayerJobView[]) => void) => vscode.Disposable;
  };
  /** Reads a paper's reader sidecar (annotations, reading position). Without it the panel shows no annotations. */
  loadSidecar?: (paperId: string) => Promise<PaperSidecar>;
  /** Papers with similar content, when the AI index is running. */
  findSimilar?: (paper: PaperRecord) => Promise<SimilarPaper[]>;
}
