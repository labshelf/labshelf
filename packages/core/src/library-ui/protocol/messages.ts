/**
 * Declares the messages the library UI and its host exchange. Every payload is plain JSON so the same union crosses a
 * webview postMessage boundary or an in-page loopback unchanged.
 */
import type { PaperStatus } from "../../model/index.js";
import type {
  AddSource, CitationMapState, IfNoPdf, LibraryUiSnapshot, PaperDetails, PaperFilesState, PdfAccess, PdfMiss, SimilarPaper, TextLayerJobView,
} from "./payloads.js";
import type { StatusFilter } from "../state/index.js";

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
  /** The single selected paper changed; null when none or several are selected. */
  | { type: "paper.selected"; id: string | null }
  | { type: "paper.files"; id: string }
  /** `name` is one entry of the paper folder; an empty `description` removes the stored one. */
  | { type: "paper.describeFile"; id: string; name: string; description: string }
  | { type: "paper.openFile"; id: string; name: string }
  | { type: "paper.revealFile"; id: string; name: string }
  | { type: "paper.copyFilePath"; id: string; name: string }
  /** `replace` looks only for a better version than the paper's preprint or accepted PDF, and replaces it when found. */
  | { type: "paper.findPdf"; id: string; replace?: boolean }
  | { type: "paper.attachPdf"; id: string }
  /** Opens the page that stood in the way of the paper's PDF, and attaches the PDF once the user gets through. */
  | { type: "paper.openForPdf"; id: string; access: PdfAccess }
  | { type: "paper.askAuthor"; id: string }
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
  | { type: "clipboard.write"; text: string; label?: string }
  | { type: "citationMap.refresh" }
  | { type: "citationMap.import"; workId: string; doi: string };

export type HostToUi =
  | { type: "snapshot"; snapshot: LibraryUiSnapshot }
  | { type: "navigate"; folder: string }
  /** Opens the library root showing only papers with this status, as a host's status scope row asks. */
  | { type: "scope"; status: StatusFilter }
  | { type: "select"; id: string }
  /** Shows the paper wherever it is: opens its folder, clears filters that hide it, selects it and opens its files. */
  | { type: "reveal"; id: string }
  | { type: "files"; id: string; state: PaperFilesState }
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
  | { type: "add.noPdf"; folder: string; sourceId: string; title: string; miss: PdfMiss }
  /** Opens the citation map view, or updates it while it is open. */
  | { type: "citationMap.show"; state: CitationMapState }
  | { type: "citationMap.imported"; workId: string }
  /** The host has already told the user why with an error `notice`; the UI only clears the row's busy state. */
  | { type: "citationMap.importFailed"; workId: string };
