// Formats paper fields as escaped Markdown text for hovers.
import type { PaperRecord } from "@labshelf/core";

export const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");

/** Authors and year on one line; empty when the paper has neither. */
export function formatPaperByline(paper: PaperRecord): string {
  return [paper.authors?.join(", "), paper.year].filter((part) => part !== undefined && part !== "").join(" ");
}

/** Collapses whitespace and cuts at a word boundary within `max` characters, marking the cut with an ellipsis. */
export function formatExcerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) { return flat; }
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
