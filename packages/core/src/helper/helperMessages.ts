/** Declares every message an extension page and LabShelf Helper exchange, with the protocol's version and limits. */
// CONTRACT: documents/contracts/helper.md#messages

import type { DeckPageMap, LocatedProblem, TexInstallKind } from "../latex/index.js";
import type { CellLanguage, CellResult, CellStatus } from "../qmd/compute/index.js";
import type { MathOp, MathResult } from "../qmd/compute/index.js";
import type { CellParamValue } from "../qmd/item/index.js";
import type { HostToGallery, PublishDraft, PublishFromHost } from "../templates/index.js";
import type { LatexEngine } from "../writing/project/index.js";

export const HELPER_HOST_NAME = "dev.labshelf.helper";
export const PROTOCOL_VERSION = 11;
// The helper program's version, kept beside the program so every app that bundles it reports the same one.
export const HELPER_VERSION = "0.6.0";

// CONTRACT: documents/contracts/helper.md#messages
export const MAX_SOCKET_MESSAGE_BYTES = 16 * 1024 * 1024;
export const MAX_OPEN_PROJECTS = 8;
export const MAX_PROJECT_FILES = 5000;
export const MAX_PROJECT_BYTES = 500 * 1024 * 1024;
export const MAX_EDIT_CHANGES = 10000;
export const MAX_PATH_LENGTH = 260;
export const MAX_CELL_CODE_BYTES = 1024 * 1024;
export const MAX_CELL_TIMEOUT_MS = 600_000;
export const MAX_NOTE_KEY_LENGTH = 512;
/** The largest deck HTML a printPdf payload may carry, under the 16 MiB socket message. */
export const MAX_PRINT_HTML_BYTES = 15 * 1024 * 1024;
/** The largest equation image an ocr payload may carry. */
export const MAX_OCR_PNG_BYTES = 4 * 1024 * 1024;
const CELL_STATUS_FLAGS: Record<CellStatus, true> = { ok: true, error: true, timeout: true, cancelled: true, missing: true };
// INVARIANT: the Record above makes the compiler fail when CellStatus gains a value this list lacks.
export const CELL_STATUSES = Object.keys(CELL_STATUS_FLAGS) as CellStatus[];

export const TEX_SOURCES = ["none", "tinytex", "texlive", "system"] as const;
export const PYTHON_STATES = ["missing", "installed"] as const;
export type PythonState = (typeof PYTHON_STATES)[number];
export type TexSource = (typeof TEX_SOURCES)[number];
/** The program that answers: the standalone LabShelf Helper, or a desktop app running the helper script. */
export const HELPER_HOSTS = ["helper", "vscode", "terminal"] as const;
export type HelperHost = (typeof HELPER_HOSTS)[number];
export const PROGRESS_PHASES = ["installing-tex", "installing-package", "python", "building", "updating"] as const;
export type HelperPhase = (typeof PROGRESS_PHASES)[number];
export const HELPER_BUILD_STATUSES = ["succeeded", "failed", "cancelled", "toolchain-missing", "needs-shell-escape"] as const;
export type HelperBuildState = (typeof HELPER_BUILD_STATUSES)[number];

export const COMPILE_MODES = ["preview", "full"] as const;
export type BuildKind = (typeof COMPILE_MODES)[number];
export interface TexToolchain { source: TexSource; year?: number; complete: boolean }
export interface HelperProgress { phase: HelperPhase; message: string; fraction?: number }
/** Replaces the characters `from` to `to` of the previous version's text with `insert`. */
export interface TextChange { from: number; to: number; insert: string }
export interface ChangedPage { index: number; offset: number; length: number }

type Envelope<T extends string> = { v: number; id: string; type: T };

// Template publication socket messages.
export type TemplatePublishRequest =
  | { action: "open" }
  | { action: "check"; draft: PublishDraft }
  | { action: "submit"; draft: PublishDraft; token: string };
type TemplatePublishMessage = { v: number; id: string; type: "publishTemplate"; projectId: string } & TemplatePublishRequest;
export type TemplatePublishEvent = PublishFromHost | Extract<HostToGallery, { type: "notice" }>;
type TemplatePublishReply = { v: number; id: string; type: "templatePublish"; event?: TemplatePublishEvent; done: boolean };

export type ToHelperMessage =
  | TemplatePublishMessage
  | Envelope<"templateThumbnail"> & { requestId: string; error?: string }
  | Envelope<"hello"> & { extensionVersion: string; origin: string }
  | Envelope<"auth"> & { token: string }
  | Envelope<"openProject"> & { projectId: string; root: string }
  | Envelope<"closeProject"> & { projectId: string }
  | Envelope<"edit"> & { projectId: string; path: string; version: number } & (
    | { text: string; changes?: undefined }
    | { changes: TextChange[]; text?: undefined })
  | Envelope<"save"> & { projectId: string; path: string }
  | Envelope<"compile"> & { projectId: string; main: string; mode: BuildKind; engine?: LatexEngine; editedFile?: string; editedLine?: number; haltOnError?: boolean }
  | Envelope<"cancel"> & { projectId: string }
  | Envelope<"installTex"> & { kind: TexInstallKind }
  | Envelope<"installAllPackages">
  | Envelope<"installPython">
  | Envelope<"runCell"> & { code: string; cwd: string; timeoutMs: number; language: CellLanguage; noteKey: string; params?: Record<string, CellParamValue>; preview?: boolean }
  | Envelope<"cancelCell"> & { requestId: string }
  | Envelope<"restartCell"> & { noteKey: string; language: CellLanguage }
  | Envelope<"evalMath"> & { noteKey: string; cwd: string; op: MathOp; tex: string }
  | Envelope<"printPdf"> & { size: string }
  | Envelope<"cancelPrint"> & { requestId: string }
  | Envelope<"ocr"> & { bytes: number }
  | Envelope<"cancelOcr"> & { requestId: string }
  | Envelope<"installPix2tex">
  | Envelope<"sourcePick">
  | Envelope<"sourceInspect"> & { folder: string }
  | Envelope<"sourceList"> & { folder: string }
  | Envelope<"sourceRead"> & { folder: string; path: string }
  | Envelope<"sourceRun"> & { folder: string; command: string; timeoutMs: number }
  | Envelope<"cancelSourceRun"> & { requestId: string };

export type ToPageMessage =
  | TemplatePublishReply
  | Envelope<"templatePreview">
  | Envelope<"ready"> & { protocol: number; helperVersion: string; host: HelperHost; tex: TexToolchain; python?: PythonState; capabilities?: string[] }
  | Envelope<"session"> & { port: number; token: string }
  | Envelope<"authed">
  | Envelope<"opened"> & { projectId: string; files: string[] }
  | Envelope<"closed"> & { projectId: string }
  | Envelope<"progress"> & HelperProgress
  | Envelope<"built"> & { status: HelperBuildState; problems: LocatedProblem[]; pdfSha256?: string; pageMap?: DeckPageMap }
  | Envelope<"pages"> & { pdfSha256: string; pageCount: number; changed: ChangedPage[] }
  | Envelope<"cellResult"> & { status: CellStatus; language: CellLanguage; restarted?: boolean; latex?: string; text?: string; error?: string; controls?: NonNullable<CellResult["controls"]>; plot?: string; warnings?: string[]; durationMs: number }
  | Envelope<"mathResult"> & { result: MathResult }
  | Envelope<"pdfPrinted"> & { bytes: number }
  | Envelope<"printFailed"> & { reason: HelperPrintFailure; message: string }
  | Envelope<"ocrResult"> & { latex: string }
  | Envelope<"ocrFailed"> & { reason: HelperOcrFailure; message: string }
  | Envelope<"sourcePicked"> & { folder?: string; unavailable?: boolean }
  | Envelope<"sourceInfo"> & { exists: boolean; remote?: string }
  | Envelope<"sourceFiles"> & { files: string[] }
  | Envelope<"sourceBytes"> & { bytes: number; missing?: boolean }
  | Envelope<"sourceRan"> & { status: HelperSourceRunStatus; code?: number | null; output?: string }
  | (Omit<Envelope<"error">, "id"> & { id?: string | undefined; code: string; message: string });

export const PRINT_FAILURES = ["noChromium", "limit", "failed"] as const;
export type HelperPrintFailure = (typeof PRINT_FAILURES)[number];
/** The capability a ready announces when the helper answers printPdf. */
export const PRINT_PDF_CAPABILITY = "printPdf";

export const OCR_FAILURES = ["missing", "limit", "failed"] as const;
export type HelperOcrFailure = (typeof OCR_FAILURES)[number];
/** The capability a ready announces when the helper answers ocr and installPix2tex. */
export const OCR_CAPABILITY = "ocr";

/** The capability a ready announces when the helper answers the linked-output source messages (sourcePick … cancelSourceRun). */
export const LINKED_OUTPUTS_CAPABILITY = "linkedOutputs";
export const SOURCE_RUN_STATUSES = ["finished", "cancelled"] as const;
export type HelperSourceRunStatus = (typeof SOURCE_RUN_STATUSES)[number];
/** The longest absolute source folder a message may name. */
export const MAX_SOURCE_FOLDER_LENGTH = 1024;
/** The largest command a sourceRun may carry. */
export const MAX_SOURCE_COMMAND_BYTES = 8 * 1024;
/** The longest a sourceRun may last: one hour. */
export const MAX_SOURCE_RUN_TIMEOUT_MS = 3_600_000;
/** sourceRan keeps only the tail of the command's output. */
export const MAX_SOURCE_OUTPUT_CHARS = 64 * 1024;

export type HelperDirection = "toHelper" | "toPage";

/** Why a frame was refused; the helper sends it back as the `code` of an `error` reply. */
export type HelperRejectionKind = "malformed" | "version" | "unknown-type" | "invalid-field" | "path" | "project-id" | "stale" | "no-library" | "limit";

export interface HelperRejection {
  ok: false;
  code: HelperRejectionKind;
  reason: string;
  /** The frame's id when it had one, so the reply can pair with it. */
  id?: string;
  /** The frame's `v` when it was a number other than PROTOCOL_VERSION. */
  received?: number;
}

export type HelperParseResult<M> = { ok: true; message: M } | HelperRejection;
