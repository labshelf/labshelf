// Picks the highlights of a paper worth quoting beside a citation: those with text, in reading order.
import type { Annotation, AnnotationColor } from "../../model/index.js";

/** A highlight's text and the 1-based page it is on. */
export interface QuotedHighlight {
  text: string;
  page: number;
  color?: AnnotationColor;
}

/** @returns at most `limit` text-bearing highlights, by page, then by creation within a page. */
export function quotedHighlights(annotations: readonly Annotation[], limit: number): QuotedHighlight[] {
  return annotations
    .filter((a) => a.type === "highlight" && a.content.trim() !== "")
    .sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit)
    .map((a) => ({ text: a.content.trim(), page: a.pageNumber }));
}
