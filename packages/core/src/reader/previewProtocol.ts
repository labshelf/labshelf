/** Declares the shapes a preview reader and its host exchange: build state, page positions and the citations behind them. */
// CONTRACT: documents/contracts/reader-host.md#preview

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
  summary?: string;
}

/** One key cited at the queried place; `paper` is absent when no library paper has the key. */
export interface CitationEntry {
  key: string;
  paper?: CitationCardPaper;
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
