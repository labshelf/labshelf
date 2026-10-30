// Declares the reader protocol: boot parameters, both message directions and the guards that validate untrusted messages.
import type { PdfTheme, Annotation, AnnotationColor, CustomReaderTheme, ReaderThemeRef, ReaderView } from "../../model/index.js";
import {
  type BuildState, type CitationEntry, type PageArea, type PagePoint, type PreviewBuildRoots, type PreviewRequest,
  checkPreviewRequest,
} from "./previewProtocol.js";
import type { ReadingState } from "../sidecar/index.js";
import { isNonEmptyString, isNumber, isRecord, isString } from "../../guards/index.js";
import { parseAnchor } from "../../qmd/item/index.js";
import { isCellLanguage, type CellLanguage, type CellRunState } from "../../qmd/compute/index.js";

// Declares the boot parameters, preferences and shared vocabulary of the reader protocol.
// DOM-free and vscode-free so both TypeScript programs (and jest) can compile it.

export const PROTOCOL_VERSION = 9;

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
  | { type: "cellState"; requestId: string; state: CellRunState }
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

/** A reader's request to cite a paper in a writing project, with the page and quote it came from. */
export interface CitationInProjectRequest {
  paperId: string;
  page?: number;
  quote?: string;
}

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
   */
  | { command: "runCell"; itemId: string; label: string; code: string; language: CellLanguage; requestId: string }
  /** Restarts the paper's `language` process, dropping what its cells defined. */
  | { command: "restartCell"; language: CellLanguage }
  | { command: "cancelCell"; requestId: string }
  | { command: "installPython" }
  | { command: "updateAnnotation"; id: string; content: string }
  | { command: "saveReadingState"; state: ReadingState }
  | { command: "copyWithCitation"; text: string; pageNumber: number }
  | { command: "sendToNote"; text: string; pageNumber: number }
  | { command: "copyText"; text: string }
  | { command: "exportAnnotations"; target: "clipboard" | "file" }
  | { command: "openExternalLink"; url: string }
  | ({ command: "citeInProject" } & CitationInProjectRequest)
  | PreviewRequest;

// Validates untrusted messages from the reader and the links a PDF asks the host to open.

const MAX_CITE_QUOTE_LENGTH = 2000;

function isCiteInProject(m: Record<string, unknown>): boolean {
  const { paperId, page, quote } = m;
  return isString(paperId) && paperId.length > 0
    && (page === undefined || (Number.isInteger(page) && (page as number) >= 1))
    && (quote === undefined || (isString(quote) && quote.length <= MAX_CITE_QUOTE_LENGTH));
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
        && isCellLanguage(m["language"]) && isNonEmptyString(m["requestId"]);
    case "restartCell":
      return isCellLanguage(m["language"]);
    case "cancelCell":
      return isNonEmptyString(m["requestId"]);
    case "installPython":
      return true;
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
    case "sendToNote":
      return isString(m["text"]) && m["text"].length > 0 && m["text"].length <= MAX_CITE_QUOTE_LENGTH && isNumber(m["pageNumber"]);
    case "copyText":
      return isString(m["text"]);
    case "exportAnnotations":
      return m["target"] === "clipboard" || m["target"] === "file";
    case "openExternalLink":
      return isString(m["url"]);
    case "citeInProject":
      return isCiteInProject(m);
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
