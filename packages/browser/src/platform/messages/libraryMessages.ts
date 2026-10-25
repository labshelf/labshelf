// Declares the runtime messages that read and open the library, with their replies and the library-changed broadcast.
export type LibraryMessage =
  /** Removes a paper just saved (the popup's undo). */
  | { type: "paper.remove"; id: string }
  /** Collections a paper can be saved into, plus the last one used. */
  | { type: "library.folders" }
  /** Which of these papers the library already holds, by key. */
  | { type: "library.lookup"; items: LibraryFindItem[] }
  /** Opens the library page on a collection, optionally selecting a paper. */
  | { type: "library.open"; folder?: string; paperId?: string }
  /** Lists the current window's http(s) tabs, excluding extension pages. */
  | { type: "tabs.list" };

/** The library's copy of a paper. */
export interface LibraryReference {
  id: string;
  path: string;
  /** Collection holding it. */
  folder: string;
  /** `<path>/paper.pdf` exists in the IndexedDB files store. Required, so the compiler finds every producer. */
  hasPdf: boolean;
}

/**
 * Background (or the reader, for "annotations") -> extension pages after the library changed. Kept OUT of
 * RuntimeMessage, because background/index forces every RuntimeMessage to be
 * handled and this broadcast is not a request.
 */
export interface LibraryChangedEvent {
  type: "library.changed";
  reason: "capture" | "attach" | "remove" | "annotations" | "askAuthor" | "folder";
  paperId?: string;
  /** A sentence for open library pages to show, for a change the user did not start there (a watched tab's PDF). */
  notice?: string;
}

export interface FolderOption {
  path: string;
  /** 0 for the root, 1 for its children, … */
  depth: number;
}

export interface FoldersReply {
  folders: FolderOption[];
  lastFolder: string;
}

export interface LibraryFindItem {
  key: string;
  doi?: string;
  arxivId?: string;
  title?: string;
  year?: number;
}

export type LibraryFindReply = Record<string, LibraryReference>;

export interface TabSummary {
  id: number;
  title: string;
  url: string;
}
