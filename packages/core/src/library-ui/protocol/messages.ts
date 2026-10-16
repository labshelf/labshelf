/**
 * Declares the messages the library UI and its host exchange. Every payload is plain JSON so the same union crosses a
 * webview postMessage boundary or an in-page loopback unchanged.
 */
import type { PaperStatus } from "../../model/index.js";
import type {
  AddSource, IfNoPdf, LibraryUiSnapshot, PaperDetails, PdfMiss, SimilarPaper, TextLayerJobView,
} from "./payloads.js";

export type UiToHost =
  | { type: "ready" }
  | { type: "navigate"; folder: string }
  | { type: "folder.create"; parent: string; name: string }
  | { type: "folder.rename"; path: string; name: string }
  | { type: "folder.delete"; path: string }
  | { type: "paper.open"; id: string; page?: number }
  | { type: "paper.openExternal"; id: string }
  | { type: "paper.reveal"; id: string }
  | { type: "paper.details"; id: string }
  | { type: "paper.similar"; id: string }
  | { type: "paper.findPdf"; id: string }
  | { type: "paper.attachPdf"; id: string }
  | { type: "paper.fetchMetadata"; id: string }
  | { type: "paper.makeSearchable"; ids: string[] }
  | { type: "paper.setStatus"; ids: string[]; status: PaperStatus }
  | { type: "paper.setTags"; ids: string[]; add: string[]; remove: string[] }
  | { type: "paper.setNote"; id: string; note: string }
  | { type: "paper.move"; ids: string[]; target: string }
  | { type: "paper.remove"; ids: string[] }
  | { type: "paper.add"; folder: string }
  | { type: "paper.addFrom"; folder: string; sourceId: string; ifNoPdf: IfNoPdf; retryPdf: boolean }
  | { type: "annotations.export"; id: string }
  | { type: "project.openSource"; project: string; file: string; line: number }
  | { type: "clipboard.write"; text: string; label?: string };

export type HostToUi =
  | { type: "snapshot"; snapshot: LibraryUiSnapshot }
  | { type: "navigate"; folder: string }
  | { type: "select"; id: string }
  | { type: "notice"; kind: "info" | "ok" | "error"; text: string }
  | { type: "progress"; key: string; text: string | null }
  | { type: "details"; id: string; details: PaperDetails }
  | { type: "similar"; id: string; items: SimilarPaper[] }
  | { type: "sidecarChanged"; id: string | null }
  | { type: "jobs"; jobs: TextLayerJobView[] }
  | { type: "pdf.busy"; id: string; busy: boolean }
  | { type: "pdf.missing"; id: string }
  | { type: "pdf.findResult"; id: string; miss: PdfMiss }
  | { type: "add.sources"; folder: string; sources: AddSource[] }
  | { type: "add.noPdf"; folder: string; sourceId: string; title: string; miss: PdfMiss };
