/**
 * Declares the ports a reader host implements so the shared host controller can answer the reader's messages on any platform.
 */
import type { Annotation, PaperRecord } from "../../model/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PaperDataStore } from "../sidecar/index.js";
import type { CitationEntry, CitationQuery, PagePoint } from "../previewProtocol.js";
import type { EffectiveTheme, HostToWebview, ReaderPrefs } from "../protocol.js";

export type NoticeKind = "info" | "ok" | "error";

export type ReaderSidecarStore = Pick<
  PaperDataStore,
  "load" | "getAnnotations" | "addHighlight" | "addNote" | "updateAnnotation" | "deleteAnnotation" | "setTheme" | "setReadingState"
>;

/** A sidecar write the host may want to react to, e.g. by scheduling a sync or telling other views. */
export type SidecarChange =
  | { kind: "annotationCreated"; annotation: Annotation }
  | { kind: "annotationUpdated"; annotation: Annotation }
  | { kind: "annotationDeleted"; annotationId: string }
  | { kind: "theme" };

/** What a host that shows a build's output as a preview does with the reader's requests. */
export interface PreviewPorts {
  /** Opens the source at the failed build's first error. */
  showBuildProblem(): Promise<void>;
  /** Opens the source behind a point of the PDF. */
  showSource(point: PagePoint): Promise<void>;
  /** The keys cited at a link or citation of the PDF, each with its library paper when there is one. */
  lookupCitation(query: CitationQuery): Promise<CitationEntry[]>;
  /** Opens a library paper in the reader. */
  openCitedPaper(paperId: string): Promise<void>;
}

export interface ReaderHostPorts {
  paper: PaperRecord;
  store: ReaderSidecarStore;
  /** Sends a message to the reader UI. */
  post(msg: HostToWebview): void;
  getPrefs(): ReaderPrefs;
  /** What the "auto" reader theme resolves to right now. */
  autoTheme(): EffectiveTheme;
  writeClipboard(text: string): Promise<void>;
  notify(message: string, kind: NoticeKind): void;
  openExternal(url: string): Promise<void>;
  /** Offers the Markdown export as a file; the host picks its name and location. */
  saveAnnotations(markdown: string): Promise<void>;
  logger: ILogger;
  sidecarChanged?(change: SidecarChange): void;
  /** Present only when the reader previews a build. */
  preview?: PreviewPorts;
  now?: () => number;
}

export type ExportAnnotationsPorts = Pick<ReaderHostPorts, "paper" | "store" | "writeClipboard" | "notify" | "saveAnnotations">;
