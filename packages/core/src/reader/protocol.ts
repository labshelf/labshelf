/**
 * Declares the typed messages and boot parameters shared by the reader's extension-host side and its bundled webview.
 * DOM-free and vscode-free so both TypeScript programs (and jest) can compile it.
 */
import type { Annotation, AnnotationColor, PdfTheme } from "../model/index.js";
import type { BuildState, CitationEntry, CitationQuery, PageArea, PagePoint, PreviewRoots } from "./previewProtocol.js";
import { isCitationQuery, isPagePoint } from "./previewProtocol.js";
import type { ReadingState } from "./sidecar/index.js";

export const PROTOCOL_VERSION = 5;

export type EffectiveTheme = Exclude<PdfTheme, "auto">;
export type ZoomPreset = "page-width" | "page-fit" | "page-actual" | "auto";
export type CitationStyle = "pandoc" | "latex" | "author-year" | "citekey";

export interface ReaderPrefs {
  vimKeys: boolean;
  defaultZoom: ZoomPreset;
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
export interface ReaderBootParams {
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

/* ── host → webview (discriminant: `type`) ───────────────────────── */

export type HostToWebview =
  | {
      type: "init";
      reading: ReadingState | null;
      annotations: Annotation[];
      prefs: ReaderPrefs;
      theme: PdfTheme;
      effectiveTheme: EffectiveTheme;
    }
  | { type: "applyTheme"; theme: PdfTheme; effectiveTheme: EffectiveTheme }
  | { type: "updateAnnotations"; annotations: Annotation[] }
  | { type: "scrollToPage"; pageNumber: number }
  | { type: "prefsChanged"; prefs: ReaderPrefs }
  | { type: "command"; id: ReaderCommandId }
  /**
   * Re-reads the PDF in place, keeping page, offset and zoom; sent after a preview's build replaced the file.
   * With `pdfUrl` the reader shows that file instead of the open one.
   */
  | { type: "reloadDocument"; pdfUrl?: string }
  /** `errors` counts the failed build's errors; it is 0 for the other states. */
  | { type: "buildStatus"; state: BuildState; errors: number }
  /** Scrolls the reader to a point and marks it, e.g. the editor cursor's position found through SyncTeX. */
  | { type: "revealPoint"; point: PagePoint }
  /** Marks regions as changed, e.g. against another version of the paper; replaces earlier marks, and an empty list clears them. */
  | { type: "showChanges"; areas: PageArea[] }
  /** Answers `lookupCitation` with the same `request`; no entries when the place cites nothing the host can name. */
  | { type: "citation"; request: number; entries: CitationEntry[] }
  /** The build roots of a writing project with their problems; replaces the earlier list. */
  | { type: "previewRoots"; roots: PreviewRoots }
  /** Opens the reader's problems view for a build root. */
  | { type: "showLogs"; root: string };

/* ── webview → host (discriminant: `command`) ────────────────────── */

export interface PerfTimeline {
  [mark: string]: number;
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
  /** The reader double-clicked this point; a preview host opens the source behind it. */
  | { command: "showSource"; point: PagePoint }
  /** Asks a preview host which cited papers stand behind a link or a citation in the PDF. */
  | { command: "lookupCitation"; request: number; query: CitationQuery }
  /** Opens a library paper named by a `citation` answer. */
  | { command: "openCitedPaper"; paperId: string }
  /** Asks a preview host to build the shown root again. */
  | { command: "recompile" }
  /** Asks a preview host to scroll the reader to the editor cursor. */
  | { command: "revealCursor" }
  /** Opens the source of the `index`-th problem of a build root. */
  | { command: "openProblem"; root: string; index: number }
  /** Opens the raw build log of a build root. */
  | { command: "openRawLog"; root: string };

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isRoot = (v: unknown): v is string => isStr(v) && v.length > 0;

/**
 * Validates an untrusted webview message against the protocol; anything malformed is rejected so host handlers never see partial payloads.
 * @returns true when `raw` is a well-formed WebviewToHost message.
 */
export function isWebviewMessage(raw: unknown): raw is WebviewToHost {
  if (!isObj(raw) || !isStr(raw["command"])) { return false; }
  const m = raw;
  switch (m["command"] as WebviewToHost["command"]) {
    case "ready-for-init":
      return true;
    case "ready":
      return isNum(m["totalPages"]);
    case "perf":
      return isObj(m["timeline"]);
    case "selectTheme":
      return isStr(m["theme"]);
    case "createAnnotation":
      return (m["type"] === "highlight" || m["type"] === "note")
        && isNum(m["pageNumber"]) && isStr(m["content"]);
    case "deleteAnnotation":
      return isStr(m["id"]) && m["id"].length > 0;
    case "updateAnnotation":
      return isStr(m["id"]) && m["id"].length > 0 && isStr(m["content"]) && m["content"].length > 0;
    case "saveReadingState":
      return isObj(m["state"]);
    case "copyWithCitation":
      return isStr(m["text"]) && isNum(m["pageNumber"]);
    case "copyText":
      return isStr(m["text"]);
    case "exportAnnotations":
      return m["target"] === "clipboard" || m["target"] === "file";
    case "openExternalLink":
      return isStr(m["url"]);
    case "showSource":
      return isPagePoint(m["point"]);
    case "lookupCitation":
      return isNum(m["request"]) && isCitationQuery(m["query"]);
    case "openCitedPaper":
      return isStr(m["paperId"]) && m["paperId"].length > 0;
    case "recompile":
    case "revealCursor":
      return true;
    case "openProblem":
      return isRoot(m["root"]) && isNum(m["index"]) && Number.isInteger(m["index"]) && m["index"] >= 0;
    case "openRawLog":
      return isRoot(m["root"]);
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
