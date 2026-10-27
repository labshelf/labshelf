// Declares what a preview reader and its host exchange: build state, build roots, requests and the problems a root shows.
import { isBoolean, isNumber, isRecord, isString, isCount, isNonEmptyString, isOneOf } from "../../guards/index.js";
import type { ReadingStatus } from "../../library/index.js";
import { type CountUpTo, type LatexEngine, LATEX_ENGINES } from "../../writing/project/index.js";
import { type BuildSchedule, AUTO_COMPILE_MODES } from "../../writing/build/index.js";
import type { QuotedHighlight } from "../../writing/citations/index.js";
import type { LocatedProblem } from "../../latex/index.js";

/** Declares the shapes a preview reader and its host exchange: build state, build roots, page positions and the citations behind them. */

/** The state of the build whose output a preview reader shows. */
export type BuildState = "building" | "succeeded" | "failed";

/** A point on a page in PDF user space: points from the page's top-left corner, y growing downwards. */
export interface PagePoint {
  page: number;
  x: number;
  y: number;
}

/** A rectangle on a page, in the same space as `PagePoint`. */
export interface PageArea {
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the reader hovered or clicked: a link, with its named destination when it has one, or text it read as a citation. */
export interface CitationQuery {
  area: PageArea;
  link: boolean;
  dest?: string;
}

/** The library paper a cite key names, as the reader's citation card shows it. */
export interface CitationCardPaper {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  status?: ReadingStatus;
  venue?: string;
  /** The library folder that holds the paper. */
  folder?: string;
  highlights?: QuotedHighlight[];
}

/** The `.bib` record of a cite key that no library paper has. */
export interface CitationBibEntry {
  title?: string;
  authors: string[];
  year?: number;
  venue?: string;
}

/** The `\cite` command that cites a key: its source file, 1-based line and command text. */
export interface CitingCommand {
  file: string;
  line: number;
  text: string;
}

/** The one fix a citation card offers: another key for an undefined one, the published venue of a preprint, or adding a `.bib`-only key to the library. */
export type CitationCardFix =
  | { kind: "replace"; suggestion: string }
  | { kind: "update"; venue: string }
  | { kind: "add" };

/** One key cited at the queried place; `paper` is absent when no library paper has the key. */
export interface CitationEntry {
  key: string;
  paper?: CitationCardPaper;
  bib?: CitationBibEntry;
  site?: CitingCommand;
  /** The page a `[p.~N]` supplement names. */
  citedPage?: number;
  fix?: CitationCardFix;
}

/** One diagnostic of a build root; `file` and `line` locate it in the source when the compiler gave a place. */
export interface PreviewProblem {
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  file?: string;
  line?: number;
}

export type PdfProblemKind = "undefinedCitation" | "undefinedReference" | "overfull" | "preprint";

/** A problem the reader marks on the PDF; `subject` is the cite key or label it is about, `area` its place when the host found one. */
export interface PdfProblem {
  kind: PdfProblemKind;
  subject?: string;
  message: string;
  file?: string;
  line?: number;
  area?: PageArea;
}

/** The build settings the preview chrome shows and changes; `includeOnly` is present only when the shown root uses `\include`. */
export interface BuildOptions {
  autoCompile: BuildSchedule;
  /** Absent for Typst, which has no engine choice; null for a LaTeX project that has not chosen one. */
  engine?: LatexEngine | null;
  /** Present only for LaTeX roots, like `engine`. */
  haltOnError?: boolean;
  includeOnly?: { file: string; on: boolean };
}

/** One document a writing project builds, with what the reader needs to show its problems and logs. */
export interface PreviewBuildRoot {
  path: string;
  failed: boolean;
  /** True when the build kept a raw log the host can open. */
  rawLog: boolean;
  /** True when the PDF of this root maps to source positions. */
  sourceLinks: boolean;
  problems: PreviewProblem[];
  /** In reading order for placed problems, then by file and line. */
  pdfProblems?: PdfProblem[];
  /** The number of citations in the root's sources. */
  cites?: number;
  /** The words of the root's sources up to `countUpTo`. */
  words?: number;
}

/** The build roots of a writing project: the main one, the one following the editor focus and the one the reader shows. */
export interface PreviewBuildRoots {
  main: string;
  focused: string;
  shown: string;
  roots: PreviewBuildRoot[];
  /** The project's page limit; absent when it sets none. */
  pageLimit?: number;
  wordLimit?: number;
  /** Where page and word counts stop; `references` when absent. */
  countUpTo?: CountUpTo;
  /** Findings of the last pre-submission check; absent before the first one. */
  checks?: number;
  options?: BuildOptions;
}

const isPage = (v: unknown): boolean => isNumber(v) && Number.isInteger(v) && v >= 1;

export const isPagePoint = (v: unknown): v is PagePoint =>
  isRecord(v) && isPage(v["page"]) && isNumber(v["x"]) && isNumber(v["y"]);

const isPageArea = (v: unknown): v is PageArea =>
  isRecord(v) && isPage(v["page"]) && isNumber(v["left"]) && isNumber(v["top"]) && isNumber(v["right"]) && isNumber(v["bottom"]);

export const isCitationQuery = (v: unknown): v is CitationQuery =>
  isRecord(v) && isPageArea(v["area"]) && isBoolean(v["link"]) && (v["dest"] === undefined || isString(v["dest"]));

/** Declares and validates the requests a preview reader sends its host. */

/** The project commands a preview reader can run on the shown root's project. */
export const PROJECT_COMMANDS = ["compareVersions", "markVersion", "checkBeforeSubmitting"] as const;
export type ProjectCommandId = (typeof PROJECT_COMMANDS)[number];

/** A change to the project's check limits: a number sets a limit, null removes it, an absent field keeps it. */
export interface CheckLimitsChange {
  pages?: number | null;
  words?: number | null;
  countUpTo?: CountUpTo;
}

/** A citation fix the reader applies: replace a key at its `\cite`, or update or add the key's paper. */
export type CitationFix =
  | { kind: "replace"; key: string; replacement: string; file: string; line: number }
  | { kind: "update" | "add"; key: string };

export type PreviewRequest =
  /** The reader double-clicked this point; a preview host opens the source behind it. */
  | { command: "showSource"; point: PagePoint }
  /** Asks a preview host which cited papers stand behind a link or a citation in the PDF. */
  | { command: "lookupCitation"; request: number; query: CitationQuery }
  /** Opens a library paper named by a `citation` answer, at `page` when given. */
  | { command: "openCitedPaper"; paperId: string; page?: number }
  /** Asks a preview host to build the shown root again. */
  | { command: "recompile" }
  /** Asks a preview host to scroll the reader to the editor cursor. */
  | { command: "revealCursor" }
  /** Opens the source of the `index`-th problem of a build root. */
  | { command: "openProblem"; root: string; index: number }
  /** Opens the raw build log of a build root. */
  | { command: "openRawLog"; root: string }
  /** Reports how many pages of the PDF a build root produced hold the paper's body. */
  | { command: "bodyPages"; root: string; contentPages: number }
  | { command: "runCommand"; id: ProjectCommandId }
  | { command: "setAutoCompile"; mode: BuildSchedule }
  | { command: "setEngine"; engine: LatexEngine }
  | { command: "setIncludeOnly"; on: boolean }
  | { command: "setHaltOnError"; on: boolean }
  | { command: "setCheckLimits"; limits: CheckLimitsChange }
  | { command: "fixCitation"; fix: CitationFix }
  /** Opens a source line; `file` is relative to the project folder, `line` counts from 1. */
  | { command: "openSourceLine"; file: string; line: number }
  /** A review note on the selected text at `point`; a preview host adds it as a comment at the source behind it. */
  | { command: "addReviewComment"; point: PagePoint; quote: string; note: string };

type Fields = Record<string, unknown>;

const isLine = (v: unknown): boolean => isCount(v) && v >= 1;

const isLimit = (v: unknown): boolean => v === undefined || v === null || isLine(v);

const isLimitsChange = (v: unknown): boolean =>
  isRecord(v) && isLimit(v["pages"]) && isLimit(v["words"])
  && (v["countUpTo"] === undefined || v["countUpTo"] === "references" || v["countUpTo"] === "end");

function isCitationFix(v: unknown): boolean {
  if (!isRecord(v) || !isNonEmptyString(v["key"])) { return false; }
  if (v["kind"] === "replace") { return isNonEmptyString(v["replacement"]) && isNonEmptyString(v["file"]) && isLine(v["line"]); }
  return v["kind"] === "update" || v["kind"] === "add";
}

const GUARDS: { [C in PreviewRequest["command"]]: (m: Fields) => boolean } = {
  showSource: (m) => isPagePoint(m["point"]),
  lookupCitation: (m) => isNumber(m["request"]) && isCitationQuery(m["query"]),
  openCitedPaper: (m) => isNonEmptyString(m["paperId"]) && (m["page"] === undefined || isLine(m["page"])),
  recompile: () => true,
  revealCursor: () => true,
  openProblem: (m) => isNonEmptyString(m["root"]) && isCount(m["index"]),
  openRawLog: (m) => isNonEmptyString(m["root"]),
  bodyPages: (m) => isNonEmptyString(m["root"]) && isCount(m["contentPages"]),
  runCommand: (m) => isOneOf(PROJECT_COMMANDS, m["id"]),
  setAutoCompile: (m) => isOneOf(AUTO_COMPILE_MODES, m["mode"]),
  setEngine: (m) => isOneOf(LATEX_ENGINES, m["engine"]),
  setIncludeOnly: (m) => isBoolean(m["on"]),
  setHaltOnError: (m) => isBoolean(m["on"]),
  setCheckLimits: (m) => isLimitsChange(m["limits"]),
  fixCitation: (m) => isCitationFix(m["fix"]),
  openSourceLine: (m) => isNonEmptyString(m["file"]) && isLine(m["line"]),
  addReviewComment: (m) => isPagePoint(m["point"]) && isString(m["quote"]) && isString(m["note"]) && m["note"].trim().length > 0,
};

/**
 * Validates an untrusted message as a preview request.
 * @returns null when `m.command` names no preview request, else whether the payload is well formed.
 */
export function checkPreviewRequest(m: Fields): boolean | null {
  const command = m["command"];
  if (!isString(command) || !Object.hasOwn(GUARDS, command)) { return null; }
  return GUARDS[command as PreviewRequest["command"]](m);
}

// Turns the located problems of a build into the problems a preview root shows.

/** `deriveFileName` turns a problem's file into the name the reader shows; the file is kept as given when absent. */
export function derivePreviewProblems(problems: readonly LocatedProblem[], fileName: (file: string) => string = (file) => file): PreviewProblem[] {
  return problems.map((problem) => ({
    severity: problem.severity,
    message: problem.message,
    ...(problem.hint ? { hint: problem.hint } : {}),
    ...(problem.file ? { file: fileName(problem.file) } : {}),
    ...(problem.line !== undefined ? { line: problem.line } : {}),
  }));
}
