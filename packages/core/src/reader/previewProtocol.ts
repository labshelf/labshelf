/** Declares the shapes a preview reader and its host exchange: build state, build roots, page positions and the citations behind them. */
// CONTRACT: documents/contracts/reader-host.md#preview
import type { PaperStatus } from "../model/index.js";
import type { QuotedHighlight } from "../writing/review/index.js";

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

/** The library paper a cite key names, as the reader's citation card shows it; `summary` is its abstract. */
export interface CitationCardPaper {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  summary?: string;
  status?: PaperStatus;
  highlights?: QuotedHighlight[];
  /** Titles of the project's sections that cite the key. */
  citedIn?: string[];
}

/** One key cited at the queried place; `paper` is absent when no library paper has the key. */
export interface CitationEntry {
  key: string;
  paper?: CitationCardPaper;
}

/** One diagnostic of a build root; `file` and `line` locate it in the source when the compiler gave a place. */
export interface PreviewProblem {
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  file?: string;
  line?: number;
}

/** One document a writing project builds, with what the reader needs to show its problems and logs. */
export interface PreviewRoot {
  path: string;
  failed: boolean;
  /** True when the build kept a raw log the host can open. */
  rawLog: boolean;
  /** True when the PDF of this root maps to source positions. */
  sourceLinks: boolean;
  problems: PreviewProblem[];
}

/** The build roots of a writing project: the main one, the one following the editor focus and the one the reader shows. */
export interface PreviewRoots {
  main: string;
  focused: string;
  shown: string;
  roots: PreviewRoot[];
  /** The project's page limit; absent when it sets none. */
  pageLimit?: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isPage = (v: unknown): boolean => isNum(v) && Number.isInteger(v) && v >= 1;

export const isPagePoint = (v: unknown): v is PagePoint =>
  isObj(v) && isPage(v["page"]) && isNum(v["x"]) && isNum(v["y"]);

const isPageArea = (v: unknown): v is PageArea =>
  isObj(v) && isPage(v["page"]) && isNum(v["left"]) && isNum(v["top"]) && isNum(v["right"]) && isNum(v["bottom"]);

export const isCitationQuery = (v: unknown): v is CitationQuery =>
  isObj(v) && isPageArea(v["area"]) && typeof v["link"] === "boolean" && (v["dest"] === undefined || typeof v["dest"] === "string");
