/**
 * Declares the messages the reader sends to the host (discriminant: `command`).
 */
import type { AnnotationColor } from "../../model/index.js";
import type { PreviewRequest } from "../previewRequests.js";
import type { ReadingState } from "../sidecar/index.js";

export interface PerfTimeline {
  [mark: string]: number;
}

/** A reader's request to cite a paper in a writing project, with the page and quote it came from. */
export interface CitationInProjectRequest {
  paperId: string;
  page?: number;
  quote?: string;
}

export type WebviewToHost =
  | { command: "ready-for-init" }
  | { command: "ready"; totalPages: number }
  | {
      command: "perf";
      timeline: PerfTimeline;
      pageNumber: number;
      theme: string;
      dpr: number;
      canvas: string | null;
    }
  | { command: "selectTheme"; theme: string }
  | {
      command: "createAnnotation";
      type: "highlight" | "note";
      pageNumber: number;
      content: string;
      color?: AnnotationColor;
      position?: Record<string, number>;
    }
  | { command: "deleteAnnotation"; id: string }
  | { command: "updateAnnotation"; id: string; content: string }
  | { command: "saveReadingState"; state: ReadingState }
  | { command: "copyWithCitation"; text: string; pageNumber: number }
  | { command: "copyText"; text: string }
  | { command: "exportAnnotations"; target: "clipboard" | "file" }
  | { command: "openExternalLink"; url: string }
  | ({ command: "citeInProject" } & CitationInProjectRequest)
  | PreviewRequest;
