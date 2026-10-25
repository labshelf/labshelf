// Lists every library paper as a citation completion inside a cite command or Typst reference.
import * as vscode from "vscode";

import { findPartialCiteKeyStart, type PaperRecord } from "@labshelf/core";
import { findPageArgumentCompletion } from "./findPageArgumentCompletion.js";
import { findCitingProject, type CitationWorkspace } from "./citationWorkspace.js";

export const UPDATE_BIBLIOGRAPHY_COMMAND = "labshelf.citations.updateBibliography";

const updateBibliography = (document: vscode.TextDocument): vscode.Command =>
  ({ command: UPDATE_BIBLIOGRAPHY_COMMAND, title: "Update bibliography", arguments: [document.uri] });

function citationItem(paper: PaperRecord, range: vscode.Range, document: vscode.TextDocument): vscode.CompletionItem {
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
  item.command = updateBibliography(document);
  return item;
}

export class CitationCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly workspace: CitationWorkspace) {}

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const project = findCitingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return undefined; }
    const pageItems = await findPageArgumentCompletion(project.settings.format, session, document, position);
    if (pageItems) {
      // A key written by a highlight pick is not in labshelf.bib yet.
      for (const item of pageItems) { item.command = updateBibliography(document); }
      return pageItems;
    }
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    const start = findPartialCiteKeyStart(project.settings.format, prefix);
    if (start === undefined) { return undefined; }
    const range = new vscode.Range(position.line, start, position.line, position.character);
    return (await session.listPapers()).map((paper) => citationItem(paper, range, document));
  }
}
