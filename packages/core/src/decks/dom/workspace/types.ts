// The ports of the talk and poster workspace: what a host (the VS Code webview or the browser source tab) gives it, and the state it reports.
import type { SourceDeckRect } from "../../index.js";
import type { SourceDeckEditing } from "../../../writing/dom/sourceEditor/index.js";
import type { PdfDeckAssets } from "../pdfDeck.js";

/** Visual: structure, stage and properties; Split: the code beside the stage; Code: the editor alone. */
export type DeckWorkspaceMode = "visual" | "split" | "code";

/** The last build of the file's root, as the header shows it. */
export interface DeckBuildState { state: "none" | "building" | "succeeded" | "failed"; errors: number }

/**
 * Links between the source and the built page, found through SyncTeX by the host. Points and boxes are in PDF points from the page's top-left
 * corner, pages 1-based. Each answers null while the build left no link data (not built yet, or no SyncTeX file).
 */
export interface DeckSourceLinks {
  /** The boxes of this file's lines [fromLine, toLine] (1-based, inclusive). */
  boxes(fromLine: number, toLine: number): Promise<SourceDeckRect[] | null>;
  /** The 1-based line of this file behind a point of a page, undefined when the point is outside it. */
  sourceAt(point: { page: number; x: number; y: number }): Promise<number | undefined | null>;
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
  present(): void;
  posterPreview(): void;
  exportPdf(): void;
  /** Opens the build's problems list. */
  showProblems(): void;
  /** Picks an image of the project and gives its path relative to the file's folder; absent, figures are written with a placeholder path. */
  pickImage?(): Promise<string | undefined>;
  /** Where the mode is kept per file. */
  mode: { read(): DeckWorkspaceMode | undefined; write(mode: DeckWorkspaceMode): void };
}

export interface DeckWorkspace {
  mode(): DeckWorkspaceMode;
  setMode(mode: DeckWorkspaceMode): void;
  dispose(): void;
}
