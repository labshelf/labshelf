// Renders a library paper's title, byline and abstract as hover text.
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");

// Opening the paper is the key's Ctrl+click link, whose tooltip shows under this hover.
export function paperHover(paper: PaperRecord): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${escapeMarkdown(paper.title)}**`);
  const byline = [paper.authors?.join(", "), paper.year].filter((part) => part !== undefined && part !== "").join(" ");
  if (byline) { markdown.appendMarkdown(`\n\n${escapeMarkdown(byline)}`); }
  if (paper.summary) { markdown.appendMarkdown(`\n\n${escapeMarkdown(paper.summary)}`); }
  return markdown;
}
