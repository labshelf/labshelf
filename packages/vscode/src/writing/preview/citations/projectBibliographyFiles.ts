// Finds the .bib files the user writes and the entry a cite key names in them, never in the generated labshelf.bib.
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER, parseBibEntries, type BibEntry } from "@labshelf/core";

export interface ProjectBibEntry {
  document: vscode.TextDocument;
  entry: BibEntry;
}

/** The project's top-level and nested `.bib` documents the user writes, in the order the workspace lists them; the generated file is left out. */
export async function listUserBibliographyFiles(projectFolder: string): Promise<vscode.TextDocument[]> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(projectFolder), "**/*.bib"));
  const documents: vscode.TextDocument[] = [];
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    // The generated file is told apart by its header, not its name, because the name is a setting.
    if (!document.getText().startsWith(BIBLIOGRAPHY_HEADER)) { documents.push(document); }
  }
  return documents;
}

/** The first entry with `key` in the user's `.bib` files. */
export async function findBibEntry(projectFolder: string, key: string): Promise<ProjectBibEntry | undefined> {
  for (const document of await listUserBibliographyFiles(projectFolder)) {
    const entry = parseBibEntries(document.getText()).find((candidate) => candidate.key === key);
    if (entry) { return { document, entry }; }
  }
  return undefined;
}
