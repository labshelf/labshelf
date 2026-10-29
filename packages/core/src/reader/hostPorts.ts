// Declares the ports a reader host implements and the per-reader context the message handlers share.
import type { Annotation, PaperRecord, PdfTheme } from "../model/index.js";
import type { ILogger } from "../ports/index.js";
import type { ReaderSidecarStore } from "./sidecar/index.js";
import type { PaperNotesStore, RunCellPort } from "../qmd/index.js";
import type { LatexEngine } from "../writing/project/index.js";
import type { BuildSchedule } from "../writing/build/index.js";
import type {
  CitationEntry, CitationQuery, PagePoint, CheckLimitsChange, CitationFix, ProjectCommandId, CitationInProjectRequest,
  EffectiveTheme, HostToWebview, ReaderNote, ReaderPrefs, WebviewToHost,
} from "./protocol/index.js";

// Declares the ports a reader host implements so the shared host controller can answer the reader's messages on any platform.

export type NoticeKind = "info" | "ok" | "error";

/** A sidecar write the host may want to react to, e.g. by scheduling a sync or telling other views. */
export type SidecarChange =
  | { kind: "annotationCreated"; annotation: Annotation }
  | { kind: "annotationUpdated"; annotation: Annotation }
  | { kind: "annotationDeleted"; annotationId: string }
  | { kind: "theme" };

/** What a host that shows a build's output as a preview does with the reader's requests. */
export interface PreviewPorts {
  /** Opens the source behind a point of the PDF. */
  showSource(point: PagePoint): Promise<void>;
  /** The keys cited at a link or citation of the PDF, each with its library paper when there is one. */
  lookupCitation(query: CitationQuery): Promise<CitationEntry[]>;
  /** Opens a library paper in the reader, at `page` when given. */
  openCitedPaper(paperId: string, page?: number): Promise<void>;
  /** Builds the shown root again. */
  recompile(): Promise<void>;
  /** Scrolls the reader to the editor cursor. */
  revealCursor(): Promise<void>;
  /** Opens the source of the `index`-th problem of a build root. */
  openProblem(root: string, index: number): Promise<void>;
  /** Opens the raw build log of a build root. */
  openRawLog(root: string): Promise<void>;
  /** The pages of a build root's PDF that hold the paper's body, as the reader counted them. */
  bodyPages?(root: string, contentPages: number): Promise<void> | void;
  /** Runs a project command on the shown root's project. */
  runCommand?(id: ProjectCommandId): Promise<void>;
  setAutoCompile?(mode: BuildSchedule): Promise<void>;
  setEngine?(engine: LatexEngine): Promise<void>;
  /** Builds only the focused included file, or every file again. */
  setIncludeOnly?(on: boolean): Promise<void>;
  setHaltOnError?(on: boolean): Promise<void>;
  /** Writes the project's check limits to labshelf.yaml. */
  setCheckLimits?(limits: CheckLimitsChange): Promise<void>;
  fixCitation?(fix: CitationFix): Promise<void>;
  /** Opens a line of a file inside the project folder. */
  openSourceLine?(file: string, line: number): Promise<void>;
  /** Adds a review note on `quote` as a comment thread at the source behind `point`. */
  addReviewComment?(point: PagePoint, quote: string, note: string): Promise<void>;
}

export interface ReaderHostPorts {
  paper: PaperRecord;
  store: ReaderSidecarStore;
  /** The paper's notes.qmd; absent in a build preview, which refuses note writes and shows no notes. */
  notes?: PaperNotesStore;
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
  /** Adds a citation of a paper to a writing project; present only when the host has projects to cite in. */
  citeInProject?(request: CitationInProjectRequest): Promise<void>;
  /** Appends a selection to a note the host lets the user pick; the host owns the picker, the write and the success notice. Absent when the host cannot send. */
  sendToNote?(request: { key: string; page: number; text: string }): Promise<void>;
  /** Runs a note's code cell; absent means the host has no runner and the reader shows no Run button. */
  runCell?: RunCellPort;
  /** Installs the Python that cells run with, as the missing-python prompt asks. */
  installPython?(): void;
  /** Present only when the reader previews a build. */
  preview?: PreviewPorts;
  now?: () => number;
}

export type ExportAnnotationsPorts = Pick<ReaderHostPorts, "paper" | "store" | "writeClipboard" | "notify" | "saveAnnotations">;

// Declares the per-reader state and helpers the message handlers share, and the shape of the handler table.

export const READER_LOG_MODULE = "reader";

export interface HostState {
  themePreference: PdfTheme;
  /** True once the reader has laid out the document; the reader drops every message but `init` and `applyTheme` before that. */
  ready: boolean;
  /** Messages held until `ready`, the latest one per type. */
  held: Map<HostToWebview["type"], HostToWebview>;
  /** JSON of the annotations the reader last received, so an unchanged list is not pushed again. */
  lastAnnotationsKey: string;
  /** JSON of the notes the reader last received. */
  lastNotesKey: string;
  openedAt: number;
}

export interface HostContext {
  readonly ports: ReaderHostPorts;
  readonly state: HostState;
  now(): number;
  effectiveTheme(theme: PdfTheme): EffectiveTheme;
  /** Posts the list unless it equals the last one sent; `force` posts it regardless. */
  pushAnnotations(annotations: Annotation[], force: boolean): void;
  /** Posts `updateNotes` with the full list unless it equals the last one sent; `force` posts it regardless. */
  pushNotes(items: ReaderNote[], force: boolean): void;
}

export type MessageAnswer<C extends WebviewToHost["command"]> = (
  ctx: HostContext,
  msg: Extract<WebviewToHost, { command: C }>,
) => Promise<void> | void;

export type MessageAnswers = { [C in WebviewToHost["command"]]: MessageAnswer<C> };
