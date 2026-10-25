/**
 * Declares what the list panel's message handlers share: the extension services, the path mapping, the channel to the
 * webview, notices, paper lookup, and the panel's own reactions to the UI's ready and navigate messages.
 */
import type { HostToUi, PaperRecord } from '@labshelf/core';
import type { LibraryPaths } from '../libraryPaths.js';
import type { ListPanelDeps } from '../listPanelDeps.js';

export interface ListHostContext {
  deps: ListPanelDeps;
  /** The path mapping, or null while no library is configured. */
  paths(): LibraryPaths | null;
  post(message: HostToUi): Promise<void>;
  notice(kind: 'info' | 'ok' | 'error', text: string): void;
  /** The records of `ids` that exist, in the order given. */
  papers(ids: readonly string[]): Promise<PaperRecord[]>;
  /** The UI mounted: push the library. */
  onReady(): Promise<void>;
  /** The UI opened a folder (absolute path). */
  onNavigate(dir: string): void;
  /** The UI's selection changed; empty when nothing is selected. */
  onSelect(ids: string[]): void;
}

export const LOG_MODULE = 'libraryUi';

