// The ports of the talk and poster workspace: what a host (the VS Code webview or the browser source tab) gives it, and the state it reports.
import type { DeckKitsPort, DeckOverflowMark, SourceDeckRect } from "../../index.js";
import type { SourceDeckEditing } from "../../../writing/dom/sourceEditor/index.js";
import type { PdfDeckAssets } from "../pdfDeck.js";

/** Visual: structure, stage and properties; Split: the code beside the stage; Code: the editor alone; Grid: every slide of a talk. */
export type DeckWorkspaceMode = "visual" | "split" | "code" | "grid";

/** The last build of the file's root, as the header shows it; `overflow` holds where a LaTeX build found content taller than the page (absent = none). */
export interface DeckBuildState { state: "none" | "building" | "succeeded" | "failed"; errors: number; overflow?: DeckOverflowMark[] }

/**
 * Links between the source and the built page, found through SyncTeX by the host. Points and boxes are in PDF points from the page's top-left
 * corner, pages 1-based. Each answers null while the build left no link data (not built yet, or no SyncTeX file).
 */
export interface DeckSourceLinks {
  /** The boxes of lines [fromLine, toLine] (1-based, inclusive) of `file` (project-relative), of this file when absent. */
  boxes(fromLine: number, toLine: number, file?: string): Promise<SourceDeckRect[] | null>;
  /**
   * The 1-based line behind a point of a page and its project-relative file (absent for this file; a bare number is a line of this file),
   * undefined when the point is outside the project's files.
   */
  sourceAt(point: { page: number; x: number; y: number }): Promise<{ line: number; file?: string } | number | undefined | null>;
}

/** The other files of the project (a talk's included files), by project-relative posix path as `path` is written. */
interface DeckSourceFiles {
  /** The file's text, undefined when it cannot be read. */
  read(path: string): Promise<string | undefined>;
  /** Writes the file's whole text; rejects with a message the workspace shows. */
  write(path: string, text: string): Promise<void>;
  /**
   * Opens the file at a 1-based line in the host's editor; absent where the host has no way. With `preserveFocus` (Split following the
   * selection) the host opens it beside without taking the focus.
   */
  open?(path: string, line: number, options?: { preserveFocus?: boolean }): void;
  /**
   * Tells the workspace when the cursor moves in another project file the host's editor shows (project-relative path, 1-based line);
   * returns the function that stops. Absent where the host cannot see that cursor.
   */
  onCursor?(listener: (path: string, line: number) => void): () => void;
}

export interface DeckWorkspacePorts {
  /** The file's project-relative path; its extension gives the format. */
  path: string;
  /** The editor's text and cursor, whole-text edits as one undo step, and range selection. */
  editing: SourceDeckEditing;
  /** The element holding the code editor (its toolbar and text); the workspace moves it into its code pane. */
  editor: HTMLElement;
  /** Tells the workspace when the text or the cursor changes; returns the function that stops. */
  subscribe(listener: { text(): void; cursor(offset: number): void }): () => void;
  /** The built PDF of the file's root: pdf.js assets and the bytes, undefined when it has not been built. */
  pdf: { assets: PdfDeckAssets; read(): Promise<ArrayBuffer | undefined>; createWorker?(workerUrl: string): Worker };
  /** Saves the file and builds its root; `onState` reports each change of the build state, at once with the current one. */
  build: { run(): void; onState(listener: (state: DeckBuildState) => void): () => void };
  /** SyncTeX links; absent where the format has none (Typst), and then the stage finds blocks by their titles. */
  links?: DeckSourceLinks;
  /** The project's other files; absent, a talk's includes are not followed and the tree is this file's alone. */
  files?: DeckSourceFiles;
  present(): void;
  posterPreview(): void;
  exportPdf(): void;
  /** Opens the build's problems list. */
  showProblems(): void;
  /** Picks an image of the project and gives its path relative to the file's folder; absent, figures are written with a placeholder path. */
  pickImage?(): Promise<string | undefined>;
  /**
   * Gives the path, relative to the file's folder, of an image dropped on the workspace: `uris` from a uri list (VS Code's Explorer),
   * `files` the LabShelf project-file payloads as dragged (the host refuses another project's file); undefined refuses the drop (not an
   * image, not one the format takes, outside the project). Absent, the workspace takes no file drops.
   */
  dropImage?(drop: { uris: string[]; files: Array<{ projectId: string; path: string }> }): Promise<string | undefined>;
  /**
   * Compiles a build copy of the deck (the source in a candidate style, never the user's file) and gives its PDF, or undefined when it could not.
   * `page` is the 1-based page to show; `key` is stable for the same text and style, so the host may cache by it. Absent, Style previews are swatches.
   */
  stylePreview?(request: { text: string; page: number; key: string }): Promise<ArrayBuffer | undefined>;
  /** The library's deck Kits: list, save and pick a logo. Absent, the Style panel has no Kits section. */
  kits?: DeckKitsPort;
  /** Where the mode is kept per file. */
  mode: { read(): DeckWorkspaceMode | undefined; write(mode: DeckWorkspaceMode): void };
}

export interface DeckWorkspace {
  mode(): DeckWorkspaceMode;
  setMode(mode: DeckWorkspaceMode): void;
  dispose(): void;
}
