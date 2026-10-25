// Lists the highlights of the cited paper, or of every paper, where a citation's page argument is being typed.
import * as vscode from "vscode";

import {
  pageArgumentContext,
  papersByCiteKey,
  quotableHighlights,
  type Annotation,
  type PaperRecord,
  type ProjectFormat,
  pageSupplement,
  quotationBefore,
  type PageArgumentContext,
} from "@labshelf/core";
import type { CitationSession } from "../citationWorkspace.js";

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
function highlightItems({ format, context, position, paper, highlights }: HighlightItemsInput): vscode.CompletionItem[] {
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

async function highlightsOfPapers(
  session: CitationSession, papers: readonly PaperRecord[],
): Promise<Array<{ paper: PaperRecord; highlights: Annotation[] }>> {
  const loaded = await Promise.all(papers.map(async (paper) => {
    try {
      return { paper, highlights: quotableHighlights(await session.highlightsOf(paper.id)) };
    } catch (error) {
      void session.logger.log("WARN", "citations", "Highlights of a paper could not be read for completion", { paperId: paper.id, error: String(error) });
      return { paper, highlights: [] };
    }
  }));
  return loaded.filter(({ highlights }) => highlights.length > 0);
}

/**
 * The page-argument items at the cursor, or undefined when the cursor is not in a page argument.
 * An empty list means a page argument whose paper has no highlight text.
 */
export async function pageArgumentCompletion(
  format: ProjectFormat, session: CitationSession, document: vscode.TextDocument, position: vscode.Position,
): Promise<vscode.CompletionItem[] | undefined> {
  const text = document.lineAt(position.line).text;
  const context = pageArgumentContext(format, text.slice(0, position.character), text.slice(position.character));
  if (!context) { return undefined; }
  const papers = await session.listPapers();
  const candidates = context.key === undefined ? papers : [papersByCiteKey(papers).get(context.key)].filter((paper): paper is PaperRecord => paper !== undefined);
  const withHighlights = await highlightsOfPapers(session, candidates);
  return withHighlights.flatMap(({ paper, highlights }) => highlightItems({ format, context, position, paper, highlights }));
}
