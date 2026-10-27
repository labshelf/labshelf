// Words the Cite from Library pickers show for a paper and for its highlights, and the citation options a highlight choice yields.
import { type Annotation, type PaperRecord } from "../../model/index.js";
import { STATUS_LABEL } from "../../library/record.js";

const LABEL_LENGTH = 120;

/** `highlight` is undefined for a citation without a page. */
export interface HighlightChoice {
  highlight?: Annotation;
  quote: boolean;
}

export interface PickText {
  label: string;
  description: string;
  detail: string;
}

export const CITE_WITHOUT_PAGE = "Cite without a page";

export function derivePaperPickText(paper: PaperRecord): PickText {
  return {
    label: paper.title,
    description: `@${paper.citeKey}`,
    detail: `${STATUS_LABEL[paper.status]}${paper.year ? ` · ${paper.year}` : ""}`,
  };
}

/** The highlight's text on one line, cut to the width of a list row. */
export function formatHighlightLabel(highlight: Annotation): string {
  const flat = highlight.content.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LENGTH ? `${flat.slice(0, LABEL_LENGTH).trimEnd()}…` : flat;
}

export const formatHighlightPage = (highlight: Annotation): string => `p. ${highlight.pageNumber}`;

/** The page and quotation options of `createCitationSnippet` for a choice. */
export function deriveChoiceCitationSpec({ highlight, quote }: HighlightChoice): { page?: number; quotation?: string } {
  return {
    ...(highlight ? { page: highlight.pageNumber } : {}),
    ...(highlight && quote ? { quotation: highlight.content } : {}),
  };
}
