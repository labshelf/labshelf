// Lists the highlights of the cited paper, or of every paper, where a citation's page argument is being typed.
import * as vscode from "vscode";

import {
  pageArgumentContext, papersByCiteKey, quotableHighlights, type Annotation, type PaperRecord, type ProjectFormat,
} from "@labshelf/core";
import type { CitationSession } from "../citationWorkspace.js";
import { highlightItems } from "./highlightItems.js";

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
