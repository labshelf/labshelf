/**
 * Declares the messages the host sends to the reader (discriminant: `type`).
 */
import type { Annotation, PdfTheme } from "../../model/index.js";
import type { BuildState, CitationEntry, PageArea, PagePoint, PreviewBuildRoots } from "../previewProtocol.js";
import type { ReadingState } from "../sidecar/index.js";
import type { EffectiveTheme, ReaderCommandId, ReaderPrefs } from "./startupParams.js";

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
