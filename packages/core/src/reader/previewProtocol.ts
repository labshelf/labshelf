/** Declares the shapes a preview reader and its host exchange: build state, build roots, page positions and the citations behind them. */
import { isBoolean, isNumber, isRecord, isString } from "../guards/index.js";
import type { ReadingStatus } from "../library/index.js";
import type { CountUpTo, LatexEngine } from "../writing/project/index.js";
import type { BuildSchedule } from "../writing/build/index.js";
import type { QuotedHighlight } from "../writing/citations/index.js";

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
