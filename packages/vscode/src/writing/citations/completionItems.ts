// Builds the completion items of a citation: the page-argument items (highlights and notes), the targets of a cited paper and the cite-key items.
import * as vscode from "vscode";

import {
  PAGE_SLOT,
  deriveNotePageSupplement,
  deriveNoteProseBefore,
  derivePageArgument,
  derivePageSupplement,
  derivePapersByCiteKey,
  deriveQuotationBefore,
  formatCiteTarget,
  listCiteTargets,
  listQuotableHighlights,
  rewriteCitation,
  type Annotation,
  type CiteTarget,
  type CitedKeyContext,
  type PageArgumentContext,
  type PaperRecord,
  type ProjectFormat,
} from "@labshelf/core";
import type { CitationSession } from "./backlinks.js";

const LABEL_TEXT_LENGTH = 60;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_TEXT_LENGTH ? `${flat.slice(0, LABEL_TEXT_LENGTH).trimEnd()}…` : flat;
}

// The key list is written with the page only when the command has none yet, so `\cite[|` ends as `\cite[p.~4]{key}`.
function insertion(
  format: ProjectFormat, context: PageArgumentContext, line: number, cursor: number, paper: PaperRecord, page: number,
): { range: vscode.Range; text: string } {
  const supplement = derivePageSupplement(format, page);
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
    const quote = vscode.TextEdit.insert(quoteAt, deriveQuotationBefore(format, highlight.content));
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

type NoteTarget = Extract<CiteTarget, { kind: "note" }>;

/** Per note with a page, an item inserting its page and one inserting the page plus the note's text before the citation. */
function noteItems({ format, context, position, paper, notes }: { format: ProjectFormat; context: PageArgumentContext; position: vscode.Position; paper: PaperRecord; notes: readonly NoteTarget[] }): vscode.CompletionItem[] {
  const { line, character } = position;
  return notes.flatMap((note, index) => {
    const supplement = deriveNotePageSupplement(format, note);
    if (supplement === undefined || note.page === undefined) { return []; }
    const { range, text } = insertion(format, context, line, character, paper, note.page);
    const prose = vscode.TextEdit.insert(new vscode.Position(line, context.commandStart), deriveNoteProseBefore(format, note.text));
    const order = `${paper.citeKey}${String(index).padStart(5, "0")}n`;
    const item = (suffix: string, rank: string, edits: vscode.TextEdit[]): vscode.CompletionItem => {
      const entry = new vscode.CompletionItem(`p. ${note.page} — ${preview(note.text)}${suffix}`, vscode.CompletionItemKind.Value);
      entry.detail = `${paper.citeKey} — ${paper.title} (note)`;
      entry.documentation = note.text;
      entry.filterText = `p. ${note.page} ${note.text} ${paper.citeKey}`;
      entry.sortText = order + rank;
      entry.insertText = text;
      entry.range = range;
      entry.additionalTextEdits = edits;
      return entry;
    };
    return [item(" · note", "a", []), item(" · note text", "b", [prose])];
  });
}

async function notesOfPaper(session: CitationSession, paper: PaperRecord): Promise<NoteTarget[]> {
  try {
    const targets = listCiteTargets(await session.highlightsOf(paper.id), await session.notesOf(paper.id));
    return targets.filter((target): target is NoteTarget => target.kind === "note" && !target.withText && target.page !== undefined);
  } catch (error) {
    void session.logger.log("WARN", "citations", "Notes of a paper could not be read for completion", { paperId: paper.id, error: String(error) });
    return [];
  }
}

async function highlightsOfPapers(
  session: CitationSession, papers: readonly PaperRecord[],
): Promise<Array<{ paper: PaperRecord; highlights: Annotation[] }>> {
  const loaded = await Promise.all(papers.map(async (paper) => {
    try {
      return { paper, highlights: listQuotableHighlights(await session.highlightsOf(paper.id)) };
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
export async function findPageArgumentCompletion(
  format: ProjectFormat, session: CitationSession, document: vscode.TextDocument, position: vscode.Position,
): Promise<vscode.CompletionItem[] | undefined> {
  const text = document.lineAt(position.line).text;
  const context = derivePageArgument(format, text.slice(0, position.character), text.slice(position.character));
  if (!context) { return undefined; }
  const papers = await session.listPapers();
  const candidates = context.key === undefined ? papers : [derivePapersByCiteKey(papers).get(context.key)].filter((paper): paper is PaperRecord => paper !== undefined);
  const withHighlights = await highlightsOfPapers(session, candidates);
  const items = withHighlights.flatMap(({ paper, highlights }) => highlightItems({ format, context, position, paper, highlights }));
  const noted = await Promise.all(candidates.map(async (paper) => ({ paper, notes: await notesOfPaper(session, paper) })));
  return [...items, ...noted.flatMap(({ paper, notes }) => noteItems({ format, context, position, paper, notes }))];
}

export const UPDATE_BIBLIOGRAPHY_COMMAND = "labshelf.citations.updateBibliography";

export const updateBibliography = (document: vscode.TextDocument): vscode.Command =>
  ({ command: UPDATE_BIBLIOGRAPHY_COMMAND, title: "Update bibliography", arguments: [document.uri] });

/** Accepting a key reopens the suggestions, so the paper's targets show right after it. */
export const KEY_ACCEPTED_COMMAND = "labshelf.citations.keyAccepted";

const keyAccepted = (document: vscode.TextDocument): vscode.Command =>
  ({ command: KEY_ACCEPTED_COMMAND, title: "Show citation targets", arguments: [document.uri] });

/** The snippet of a citation rewrite: the page slot becomes a tab stop; appendText escapes the snippet specials. */
function createTargetSnippet(text: string): vscode.SnippetString {
  const [before = "", ...rest] = text.split(PAGE_SLOT);
  const snippet = new vscode.SnippetString().appendText(before);
  rest.forEach((part) => { snippet.appendTabstop(1).appendText(part); });
  return snippet;
}

export function targetItems(
  format: ProjectFormat, context: CitedKeyContext, position: vscode.Position, paper: PaperRecord, targets: readonly CiteTarget[], document: vscode.TextDocument,
  original: string,
): vscode.CompletionItem[] {
  const range = new vscode.Range(position.line, context.commandStart, position.line, context.commandEnd);
  return targets.map((target, index) => {
    const { label, detail } = formatCiteTarget(target);
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Value);
    item.detail = `${detail} — ${paper.citeKey}`;
    item.sortText = String(index).padStart(5, "0");
    item.filterText = `${context.command}{${context.key}} ${label}`;
    item.range = range;
    const text = rewriteCitation(format, context, target);
    if (text === undefined) {
      item.insertText = original;
    } else {
      item.insertText = target.kind === "page" ? createTargetSnippet(text) : text;
    }
    item.command = updateBibliography(document);
    return item;
  });
}

export function citationItem(paper: PaperRecord, range: vscode.Range, document: vscode.TextDocument): vscode.CompletionItem {
  const authors = paper.authors?.join(", ");
  const item = new vscode.CompletionItem(
    { label: paper.citeKey, ...(paper.year === undefined ? {} : { description: String(paper.year) }) },
    vscode.CompletionItemKind.Reference,
  );
  item.detail = paper.title;
  item.documentation = [authors, paper.year].filter((part) => part !== undefined && part !== "").join(" ");
  item.filterText = [paper.citeKey, paper.title, authors].filter(Boolean).join(" ");
  // "0" ranks library papers ahead of keys other providers complete from a .bib file.
  item.sortText = `0${paper.citeKey}`;
  item.insertText = paper.citeKey;
  item.range = range;
  item.command = keyAccepted(document);
  return item;
}

export async function targetsOfPaper(session: CitationSession, paper: PaperRecord): Promise<CiteTarget[]> {
  let annotations: Annotation[] = [];
  try {
    annotations = await session.highlightsOf(paper.id);
  } catch (error) {
    void session.logger.log("WARN", "citations", "Highlights of a paper could not be read for targets", { paperId: paper.id, error: String(error) });
  }
  return listCiteTargets(annotations, await session.notesOf(paper.id));
}
