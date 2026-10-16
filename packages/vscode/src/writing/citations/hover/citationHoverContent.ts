// Builds the compact hover block of a cited paper: title, reader link, byline, abstract excerpt, highlights and other citing sections.
import * as vscode from "vscode";

import type { ChecklistSection, PaperRecord, QuotedHighlight } from "@labshelf/core";
import { escapeMarkdown, excerpt, paperByline } from "./paperText.js";

const ABSTRACT_CHARS = 200;
const HIGHLIGHT_CHARS = 140;
const SECTIONS_SHOWN = 4;
const OPEN_PAPER_COMMAND = "labshelf.openPdfViewer";

export interface CitationHoverData {
  paper: PaperRecord;
  highlights: readonly QuotedHighlight[];
  /** Sections that cite the key, without the one the hover is in. */
  otherSections: readonly ChecklistSection[];
}

function alsoCitedIn(sections: readonly ChecklistSection[]): string {
  const shown = sections.slice(0, SECTIONS_SHOWN).map((section) => `§ ${escapeMarkdown(section.title)}`);
  const more = sections.length - shown.length;
  return `Also cited in ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

export function citationHoverContent({ paper, highlights, otherSections }: CitationHoverData): vscode.MarkdownString {
  const openArgs = encodeURIComponent(JSON.stringify([paper.id]));
  const blocks = [`**${escapeMarkdown(paper.title)}**`, `[Open paper](command:${OPEN_PAPER_COMMAND}?${openArgs})`];
  const byline = paperByline(paper);
  if (byline) { blocks.push(escapeMarkdown(byline)); }
  if (paper.summary?.trim()) { blocks.push(escapeMarkdown(excerpt(paper.summary, ABSTRACT_CHARS))); }
  if (highlights.length > 0) {
    blocks.push(highlights.map((quote) => `- ${escapeMarkdown(excerpt(quote.text, HIGHLIGHT_CHARS))} (${escapeMarkdown(`p. ${quote.page}`)})`).join("\n"));
  }
  if (otherSections.length > 0) { blocks.push(alsoCitedIn(otherSections)); }
  const markdown = new vscode.MarkdownString(blocks.join("\n\n"));
  // Only the reader command may run from this hover; paper text is escaped, so it cannot add links.
  markdown.isTrusted = { enabledCommands: [OPEN_PAPER_COMMAND] };
  return markdown;
}
