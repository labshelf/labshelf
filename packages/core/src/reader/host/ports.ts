/**
 * Declares the ports a reader host implements so the shared host controller can answer the reader's messages on any platform.
 */
import type { Annotation, PaperRecord } from "../../model/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PaperDataStore } from "../sidecar/index.js";
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

/** Reading analytics hooks; a host without analytics leaves them out. */
export interface ReaderActivityPort {
  opened(): void;
  pageChanged(page: number): void;
  annotated(page: number): void;
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
  activity?: ReaderActivityPort;
  now?: () => number;
}

export type ExportAnnotationsPorts = Pick<ReaderHostPorts, "paper" | "store" | "writeClipboard" | "notify" | "saveAnnotations">;
