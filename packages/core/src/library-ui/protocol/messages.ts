/**
 * The messages the library UI and its host exchange. Every payload is plain JSON so the same union crosses a
 * webview postMessage boundary or an in-page loopback unchanged.
 */
import type { FolderTreeNode } from "../../library/index.js";
import type { PaperRecord, PaperStatus } from "../../model/index.js";

/** What a PDF search tried before it gave up. */
export interface PdfMiss {
  /** Candidate URLs downloaded and rejected. */
  tried: number;
  /** Resolver ids consulted, in chain order. */
  sources: string[];
  /** At least one candidate answered with a bot check. */
  blocked: boolean;
}

/** The library as the UI renders it. `pdfDirs` lists the record paths whose folder holds the paper's PDF. */
export interface LibraryUiSnapshot {
  folders: FolderTreeNode[];
  papers: PaperRecord[];
  pdfDirs: string[];
}

/** Something the host can add a paper from, such as an open browser tab. */
export interface AddSource {
  id: string;
  label: string;
  description: string;
}

/** Whether a capture without a PDF asks first or saves the reference anyway. */
export type IfNoPdf = "ask" | "save";

export type UiToHost =
  | { type: "ready" }
  | { type: "navigate"; folder: string }
  | { type: "folder.create"; parent: string; name: string }
  | { type: "folder.rename"; path: string; name: string }
  | { type: "folder.delete"; path: string }
  | { type: "paper.open"; id: string }
  | { type: "paper.findPdf"; id: string }
  | { type: "paper.attachPdf"; id: string }
  | { type: "paper.setStatus"; ids: string[]; status: PaperStatus }
  | { type: "paper.move"; ids: string[]; target: string }
  | { type: "paper.remove"; ids: string[] }
  | { type: "paper.add"; folder: string }
  | { type: "paper.addFrom"; folder: string; sourceId: string; ifNoPdf: IfNoPdf; retryPdf: boolean }
  | { type: "clipboard.write"; text: string };

export type HostToUi =
  | { type: "snapshot"; snapshot: LibraryUiSnapshot }
  | { type: "navigate"; folder: string }
  | { type: "select"; id: string }
  | { type: "notice"; kind: "info" | "ok" | "error"; text: string }
  | { type: "progress"; key: string; text: string | null }
  | { type: "pdf.busy"; id: string; busy: boolean }
  | { type: "pdf.missing"; id: string }
  | { type: "pdf.findResult"; id: string; miss: PdfMiss }
  | { type: "add.sources"; folder: string; sources: AddSource[] }
  | { type: "add.noPdf"; folder: string; sourceId: string; title: string; miss: PdfMiss };
