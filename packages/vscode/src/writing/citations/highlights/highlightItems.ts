// Builds the completion items that insert a highlight's page, with or without its quotation.
import * as vscode from "vscode";

import {
  pageSupplement, quotationBefore, type Annotation, type PageArgumentContext, type PaperRecord, type ProjectFormat,
} from "@labshelf/core";

const LABEL_TEXT_LENGTH = 60;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_TEXT_LENGTH ? `${flat.slice(0, LABEL_TEXT_LENGTH).trimEnd()}…` : flat;
}

// The key list is written with the page only when the command has none yet, so `\cite[|` ends as `\cite[p.~4]{key}`.
function insertion(
  format: ProjectFormat, context: PageArgumentContext, line: number, cursor: number, paper: PaperRecord, page: number,
): { range: vscode.Range; text: string } {
  const supplement = pageSupplement(format, page);
  if (context.hasKeys) {
    return { range: new vscode.Range(line, context.start, line, context.close ?? cursor), text: supplement };
  }
  const end = context.end ?? cursor;
  return { range: new vscode.Range(line, context.start, line, end), text: `${supplement}]{${paper.citeKey}}` };
}

interface HighlightItemsInput {
  format: ProjectFormat;
  context: PageArgumentContext;
  position: vscode.Position;
  paper: PaperRecord;
  highlights: readonly Annotation[];
}

/** Per highlight, an item inserting its page and one inserting the page plus the quotation before the citation. */
export function highlightItems({ format, context, position, paper, highlights }: HighlightItemsInput): vscode.CompletionItem[] {
  const { line, character } = position;
  return highlights.flatMap((highlight, index) => {
    const { range, text } = insertion(format, context, line, character, paper, highlight.pageNumber);
    const quoteAt = new vscode.Position(line, context.commandStart);
    const quote = vscode.TextEdit.insert(quoteAt, quotationBefore(format, highlight.content));
    // Papers by key, highlights in page order, and the plain page ahead of its quotation.
    const order = `${paper.citeKey}${String(index).padStart(5, "0")}`;
    const item = (suffix: string, rank: string, edits: vscode.TextEdit[]): vscode.CompletionItem => {
      const entry = new vscode.CompletionItem(`p. ${highlight.pageNumber} — ${preview(highlight.content)}${suffix}`, vscode.CompletionItemKind.Value);
      entry.detail = `${paper.citeKey} — ${paper.title}`;
      entry.documentation = highlight.content;
      entry.filterText = `p. ${highlight.pageNumber} ${highlight.content} ${paper.citeKey}`;
      entry.sortText = order + rank;
      entry.insertText = text;
      entry.range = range;
      entry.additionalTextEdits = edits;
      return entry;
    };
    return [item("", "a", []), item(" · quote", "b", [quote])];
  });
}
