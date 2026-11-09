// Declares the reader protocol: boot parameters, both message directions and the guards that validate untrusted messages.
import type { PdfTheme, Annotation, AnnotationColor, CustomReaderTheme, ReaderThemeRef, ReaderView } from "../../model/index.js";
import {
  type BuildState, type CitationEntry, type PageArea, type PagePoint, type PreviewBuildRoots, type PreviewRequest,
  checkPreviewRequest,
} from "./previewProtocol.js";
import type { ReadingState } from "../sidecar/index.js";
import { isNonEmptyString, isNumber, isOneOf, isRecord, isString } from "../../guards/index.js";
import { parseAnchor, readRequestParams } from "../../qmd/item/index.js";
import { isCellLanguage, type CellLanguage, type CellRequest, type CellResult, type CellRunState } from "../../qmd/compute/index.js";
import { isMathOp, type MathRequest, type MathResult } from "../../qmd/compute/index.js";
import { isNoteFileRequest, type NoteFileReply, type NoteFileRequest } from "../../qmd/index.js";
import type { CiteProject, CiteReply, CiteRequest } from "../../writing/citations/index.js";
import { PROJECT_FORMATS } from "../../writing/project/index.js";

// Declares the boot parameters, preferences and shared vocabulary of the reader protocol.
// DOM-free and vscode-free so both TypeScript programs (and jest) can compile it.

export const PROTOCOL_VERSION = 12;

export type EffectiveTheme = Exclude<PdfTheme, "auto">;
export type ZoomKind = "page-width" | "page-fit" | "page-actual" | "auto";
export type CitationStyle = "pandoc" | "latex" | "author-year" | "citekey";

export interface ReaderPrefs {
  vimKeys: boolean;
  defaultZoom: ZoomKind;
  toolbarAutoHide: boolean;
  restorePosition: boolean;
  hoverPreviews: boolean;
  hoverDelayMs: number;
  citationStyle: CitationStyle;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  vimKeys: false,
  defaultZoom: "page-width",
  toolbarAutoHide: true,
  restorePosition: true,
  hoverPreviews: true,
  hoverDelayMs: 250,
  citationStyle: "pandoc",
};

export interface ReaderAssets {
  pdfjsUrl: string;
  viewerUrl: string;
  workerUrl: string;
  pdfUrl: string;
  cMapUrl: string;
  stdFontUrl: string;
  wasmUrl: string;
  iccUrl: string;
}

/** Serialized into the inert JSON boot block of the HTML shell. */
export interface ReaderStartupParams {
  protocolVersion: number;
  assets: ReaderAssets;
  paperId: string;
  paperTitle: string;
  /** The paper's cite key, which the cite popup previews; absent or empty, the reader offers no Cite…. */
  citeKey?: string;
  /** True when the reader shows a build's output (see the Preview section of the reader-host contract). */
  preview: boolean;
  themePreference: PdfTheme;
  effectiveTheme: EffectiveTheme;
  prefs: ReaderPrefs;
  isMac: boolean;
}

/** Actions the host can trigger in the focused reader (contributed keybindings, palette commands). */
export type ReaderCommandId =
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "find"
  | "historyBack"
  | "historyForward"
  | "toggleSidebar";

// Declares the messages the host sends to the reader (discriminant: `type`).

export type HostToWebview =
  | {
      type: "init";
      reading: ReadingState | null;
      annotations: Annotation[];
      notes: ReaderNote[];
      prefs: ReaderPrefs;
      theme: ReaderThemeRef;
      effectiveTheme: EffectiveTheme;
      /** The colours of the paper's custom theme; absent for a preset or a custom ref whose theme is gone. */
      customTheme?: CustomReaderTheme;
      /** The library's custom themes, live ones only; empty where the host has no library. */
      customThemes: CustomReaderTheme[];
      /** The paper's scroll and spread mode; null until the reader changed them. */
      view: ReaderView | null;
      /** True only where the host has a cell runner; absent means false. */
      canRunCells?: boolean;
    }
  /** `effectiveTheme` is the preset the chrome falls back to; a custom theme also sends its colours. */
  | { type: "applyTheme"; theme: ReaderThemeRef; effectiveTheme: EffectiveTheme; customTheme?: CustomReaderTheme }
  /** Replaces the list of custom themes, after this or another reader saved or deleted one. */
  | { type: "customThemes"; themes: CustomReaderTheme[] }
  | { type: "updateAnnotations"; annotations: Annotation[] }
  /** Replaces the paper's notes (the `notes.qmd` items) with this list. */
  | { type: "updateNotes"; items: ReaderNote[] }
  /** Answers `runCell` with the same `requestId`; the end states follow the `updateNotes` of the written output. */
  | { type: "cellState"; requestId: string; state: CellRunState; durationMs?: number; warnings?: readonly string[] }
  /** Answers a `runCell` with `preview` set and the same `requestId`: the result of a run that was not stored, with the cell's controls. */
  | { type: "cellPreview"; requestId: string; result: CellResult }
  /** Answers `evalMath` with the same `requestId`: the runner's result for the prose math, which writes nothing. */
  | { type: "mathResult"; requestId: string; result: MathResult }
  /** Answers a `noteFile` request with the same `requestId`. */
  | NoteFileReply
  /** Answers a `cite` request with the same `requestId`. */
  | CiteReplyMessage
  | { type: "scrollToPage"; pageNumber: number }
  | { type: "prefsChanged"; prefs: ReaderPrefs }
  | { type: "command"; id: ReaderCommandId }
  /**
   * Re-reads the PDF in place, keeping page, offset and zoom; sent after a preview's build replaced the file.
   * With `pdfUrl` the reader shows that file instead of the open one.
   */
  | { type: "reloadDocument"; pdfUrl?: string }
  /**
   * `errors` counts the failed build's errors; it is 0 for the other states.
   * `builtAt` is the last successful build of the shown root in epoch milliseconds; `stale` marks a source saved or edited since.
   */
  | { type: "buildStatus"; state: BuildState; errors: number; stale?: boolean; builtAt?: number }
  /** Scrolls the reader to a point and marks it, e.g. the editor cursor's position found through SyncTeX. */
  | { type: "revealPoint"; point: PagePoint }
  /** Marks regions as changed, e.g. against another version of the paper; replaces earlier marks, and an empty list clears them. */
  | { type: "showChanges"; areas: PageArea[] }
  /** Answers `lookupCitation` with the same `request`; no entries when the place cites nothing the host can name. */
  | { type: "citation"; request: number; entries: CitationEntry[] }
  /** The build roots of a writing project with their problems; replaces the earlier list. */
  | { type: "previewRoots"; roots: PreviewBuildRoots }
  /** Opens the reader's problems view for a build root. */
  | { type: "showLogs"; root: string };

// Declares the messages the reader sends to the host (discriminant: `command`).

export interface ReaderTimeline {
  [mark: string]: number;
}

/** The host's answer to a `cite` request of the reader's cite popup. */
export interface CiteReplyMessage { type: "cite.reply"; requestId: string; reply: CiteReply }

export type WebviewToHost =
  | { command: "toggleDetails" }
  | { command: "ready-for-init" }
  | { command: "ready"; totalPages: number }
  | {
      command: "perf";
      timeline: ReaderTimeline;
      pageNumber: number;
      theme: string;
      dpr: number;
      canvas: string | null;
    }
  | { command: "selectTheme"; theme: string }
  /** Creates a custom theme (no `id`) and selects it for the paper, or edits the theme `id`. */
  | { command: "saveCustomTheme"; theme: { id?: string; name: string; page: string; ink: string } }
  | { command: "deleteCustomTheme"; id: string }
  | { command: "setViewMode"; scroll: string; spread: string }
  | {
      command: "createAnnotation";
      type: "highlight";
      pageNumber: number;
      content: string;
      color?: AnnotationColor;
      position?: Record<string, number>;
      style?: "underline";
    }
  | { command: "deleteAnnotation"; id: string }
  /** `anchor` is the anchor attribute string; empty for an unanchored note. */
  | { command: "addNote"; anchor: string; body: string }
  | { command: "editNote"; id: string; body: string }
  /** Moves or resizes a text-box note: `anchor` is its new anchor attribute string. */
  | { command: "moveNote"; id: string; anchor: string }
  | { command: "removeNote"; id: string }
  /**
   * Runs one code cell of a note item in `language`; the reader makes `requestId` and the host echoes it in `cellState`.
   * The host derives the note key from its paper; the reader never sends one.
   * `params` are the cell's param values; a `preview` run is answered with `cellPreview` and writes nothing.
   */
  | { command: "runCell"; itemId: string; label: string; code: string; language: CellLanguage; requestId: string; params?: CellRequest["params"]; preview?: boolean }
  /** Restarts the paper's `language` process, dropping what its cells defined. */
  | { command: "restartCell"; language: CellLanguage }
  | { command: "cancelCell"; requestId: string }
  | { command: "installPython" }
  /**
   * Evaluates the `tex` of prose math with `op` in the paper note's session; the reader makes `requestId` and the host echoes it in `mathResult`.
   * `itemId` names the note item the math sits in and is only logged; the host derives the note key from its paper.
   */
  | { command: "evalMath"; requestId: string; itemId: string; op: MathRequest["op"]; tex: string }
  /** Reads, writes or picks a file of the paper note (a chart's assets/<id>.csv); the host derives the note from its paper and answers with a NoteFileReply. */
  | { command: "noteFile"; request: NoteFileRequest }
  /** A request of the cite popup about the paper the host bound to this reader; the host answers with a `cite.reply` of the same `requestId`. */
  | { command: "cite"; requestId: string; request: CiteRequest }
  | { command: "updateAnnotation"; id: string; content: string }
  | { command: "saveReadingState"; state: ReadingState }
  | { command: "copyWithCitation"; text: string; pageNumber: number }
  | { command: "copyText"; text: string }
  | { command: "exportAnnotations"; target: "clipboard" | "file" }
  | { command: "openExternalLink"; url: string }
  | PreviewRequest;

// Validates untrusted messages from the reader and the links a PDF asks the host to open.

/** The longest passage a `cite` insert may carry. */
export const MAX_CITE_QUOTE_LENGTH = 2000;

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}

/** A relative '/' path with no empty, '.' or '..' segment, backslash or drive letter. */
function isRelativeProjectPath(value: unknown): boolean {
  if (!isNonEmptyString(value) || value.includes("\\") || /^[A-Za-z]:/.test(value)) { return false; }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** True for a well-formed cite popup request (plan reader-cite-popup D1). */
export function isCiteRequest(raw: unknown): raw is CiteRequest {
  if (!isRecord(raw)) { return false; }
  switch (raw["kind"]) {
    case "targets":
      return true;
    case "read":
      return isNonEmptyString(raw["projectId"]) && isRelativeProjectPath(raw["path"]);
    case "insert": {
      const { offset, page, quote } = raw;
      return isNonEmptyString(raw["projectId"]) && isRelativeProjectPath(raw["path"]) && isNonEmptyString(raw["version"])
        && Number.isInteger(offset) && (offset as number) >= 0
        && (page === undefined || isPositiveInteger(page))
        && (quote === undefined || (isString(quote) && quote.length <= MAX_CITE_QUOTE_LENGTH))
        && typeof raw["quoted"] === "boolean";
    }
    case "bibliography":
      return isNonEmptyString(raw["projectId"]);
    default:
      return false;
  }
}

function isCiteProject(raw: unknown): raw is CiteProject {
  return isRecord(raw) && isNonEmptyString(raw["id"]) && isString(raw["title"])
    && isOneOf(PROJECT_FORMATS, raw["format"])
    && isNonEmptyString(raw["bibliography"]) && typeof raw["inBibliography"] === "boolean"
    && Array.isArray(raw["files"]) && raw["files"].every(isRelativeProjectPath);
}

function isCiteReply(raw: unknown): raw is CiteReply {
  if (!isRecord(raw)) { return false; }
  switch (raw["kind"]) {
    case "targets":
      return Array.isArray(raw["projects"]) && raw["projects"].every(isCiteProject);
    case "source":
      return isString(raw["text"]) && isNonEmptyString(raw["version"]);
    case "inserted":
      return isRelativeProjectPath(raw["path"]) && isString(raw["citation"]);
    case "listed":
      return isNonEmptyString(raw["bibliography"]);
    case "error":
      return isString(raw["message"]) && (raw["stale"] === undefined || raw["stale"] === true);
    default:
      return false;
  }
}

/** True for a well-formed `cite.reply` message, so the popup settles a request only with a reply it can read. */
export function isCiteReplyMessage(raw: unknown): raw is CiteReplyMessage {
  return isRecord(raw) && raw["type"] === "cite.reply" && isNonEmptyString(raw["requestId"]) && isCiteReply(raw["reply"]);
}

// An empty anchor is valid (an unanchored note); a non-empty one must be in a known form.
function isKnownAnchor(value: unknown): boolean {
  return isString(value) && parseAnchor(value).kind !== "unknown";
}

// Validates the note and cell commands; null when `m` is not one of them.
function checkNoteMessage(m: Record<string, unknown>): boolean | null {
  switch (m["command"]) {
    case "addNote":
      return isString(m["body"]) && isKnownAnchor(m["anchor"]);
    case "editNote":
      return isNonEmptyString(m["id"]) && isString(m["body"]);
    case "moveNote":
      return isNonEmptyString(m["id"]) && isKnownAnchor(m["anchor"]);
    case "removeNote":
      return isNonEmptyString(m["id"]);
    case "runCell":
      return isNonEmptyString(m["itemId"]) && isNonEmptyString(m["label"]) && isNonEmptyString(m["code"])
        && isCellLanguage(m["language"]) && isNonEmptyString(m["requestId"])
        && (m["params"] === undefined || readRequestParams(m["params"]) !== undefined)
        && (m["preview"] === undefined || typeof m["preview"] === "boolean");
    case "restartCell":
      return isCellLanguage(m["language"]);
    case "cancelCell":
      return isNonEmptyString(m["requestId"]);
    case "installPython":
      return true;
    case "evalMath":
      return isNonEmptyString(m["requestId"]) && isNonEmptyString(m["itemId"]) && isMathOp(m["op"]) && isString(m["tex"]);
    case "noteFile":
      return isNoteFileRequest(m["request"]);
    case "cite":
      return isNonEmptyString(m["requestId"]) && isCiteRequest(m["request"]);
    default:
      return null;
  }
}

/**
 * Validates an untrusted webview message against the protocol; anything malformed is rejected so host handlers never see partial payloads.
 * @returns true when `raw` is a well-formed WebviewToHost message.
 */
export function isWebviewMessage(raw: unknown): raw is WebviewToHost {
  if (!isRecord(raw) || !isString(raw["command"])) { return false; }
  const m = raw;
  const preview = checkPreviewRequest(m) ?? checkNoteMessage(m);
  if (preview !== null) { return preview; }
  switch (m["command"] as Exclude<WebviewToHost, PreviewRequest>["command"]) {
    case "toggleDetails":
    case "ready-for-init":
      return true;
    case "ready":
      return isNumber(m["totalPages"]);
    case "perf":
      return isRecord(m["timeline"]);
    case "selectTheme":
      return isString(m["theme"]);
    case "saveCustomTheme": {
      const theme = m["theme"];
      return isRecord(theme) && isString(theme["name"]) && isString(theme["page"]) && isString(theme["ink"])
        && (theme["id"] === undefined || isString(theme["id"]));
    }
    case "deleteCustomTheme":
      return isNonEmptyString(m["id"]);
    case "setViewMode":
      return isString(m["scroll"]) && isString(m["spread"]);
    case "createAnnotation":
      return m["type"] === "highlight"
        && isNumber(m["pageNumber"]) && isString(m["content"])
        && (m["style"] === undefined || m["style"] === "underline");
    case "deleteAnnotation":
      return isString(m["id"]) && m["id"].length > 0;
    case "updateAnnotation":
      return isString(m["id"]) && m["id"].length > 0 && isString(m["content"]) && m["content"].length > 0;
    case "saveReadingState":
      return isRecord(m["state"]);
    case "copyWithCitation":
      return isString(m["text"]) && isNumber(m["pageNumber"]);
    case "copyText":
      return isString(m["text"]);
    case "exportAnnotations":
      return m["target"] === "clipboard" || m["target"] === "file";
    case "openExternalLink":
      return isString(m["url"]);
    default:
      return false;
  }
}

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Accepts only web and mail links so a crafted PDF cannot make the host open file:, command: or vscode: URIs.
 * @returns true when the URL parses and uses an allowed scheme.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export interface ReaderNote { id: string; anchor: string; body: string; created: string; author: string }
