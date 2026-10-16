/**
 * Declares what the list panel needs from the extension: the paper service, events, the library root, the library snapshot and
 * folder changes, the citation map, OCR jobs, reader sidecars, the AI index, the writing projects' citations and paper files.
 */
import type * as vscode from 'vscode';
import type { Annotation, BacklinkIndex, ILogger, LibrarySnapshot, PaperFilesState, PaperRecord, PathOps, SimilarPaper, TextLayerJobView } from '@labshelf/core';
import type { PaperService } from '../../core/index.js';
import type { CitationMapPorts } from '../../citationMap/index.js';
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

/** The writing projects that cite papers; the panel shows them as "Cited in" and opens their sources. */
interface ListProjectBacklinks {
  index(): BacklinkIndex;
  /** The folder of the ready project with this id. */
  projectFolder(id: string): string | undefined;
  onDidChange: vscode.Event<void>;
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
  citationMap: CitationMapPorts;
  /** Called whenever the panel shows a different folder, so the sidebar tree can follow. */
  onDidNavigate?: (folder: LibraryNode) => void;
  /** Called when the user selects one paper in the panel, so the sidebar tree can select its row. */
  onDidSelectPaper?: (paperId: string) => void;
  /** Papers waiting for or undergoing OCR, shown on their rows while it runs. */
  textLayerJobs?: {
    current: () => TextLayerJobView[];
    onDidChange: (listener: (jobs: TextLayerJobView[]) => void) => vscode.Disposable;
  };
  /** Reads a paper's reader sidecar (annotations, reading position). Without it the panel shows no annotations. */
  loadSidecar?: (paperId: string) => Promise<PaperSidecar>;
  projectBacklinks?: ListProjectBacklinks;
  /** Papers with similar content, when the AI index is running. */
  findSimilar?: (paper: PaperRecord) => Promise<SimilarPaper[]>;
  /** A paper folder's files and their descriptions; `describe` resolves undefined when it refuses the name. */
  paperFiles?: {
    list(paperId: string): Promise<PaperFilesState>;
    describe(paperId: string, name: string, description: string): Promise<PaperFilesState | undefined>;
  };
}
