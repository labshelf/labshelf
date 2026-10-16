// Registers citation completion, hover, links and bibliography updates for LaTeX and Typst sources.
import * as vscode from "vscode";

import { BibliographySync } from "./bibliographySync.js";
import { CitationCompletionProvider, UPDATE_BIBLIOGRAPHY_COMMAND } from "./citationCompletion.js";
import { CitationHoverProvider } from "./hover/index.js";
import { CitationLinkProvider } from "./citationLinks.js";
import type { CitationWorkspace } from "./citationWorkspace.js";

// Typst has no built-in language id, so sources are matched by file name.
const SOURCES = [
  { selector: { scheme: "file", pattern: "**/*.tex" }, triggers: ["{", ",", "["] },
  { selector: { scheme: "file", pattern: "**/*.typ" }, triggers: ["@", "<", "["] },
];

export function registerCitationProviders(
  context: vscode.ExtensionContext,
  workspace: CitationWorkspace,
): void {
  const sync = new BibliographySync(workspace);
  const completion = new CitationCompletionProvider(workspace);
  const hover = new CitationHoverProvider(workspace);
  const links = new CitationLinkProvider(workspace);
  for (const { selector, triggers } of SOURCES) {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(selector, completion, ...triggers),
      vscode.languages.registerHoverProvider(selector, hover),
      vscode.languages.registerDocumentLinkProvider(selector, links),
    );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(UPDATE_BIBLIOGRAPHY_COMMAND, (uri: vscode.Uri) => sync.update(uri.fsPath)),
    vscode.workspace.onDidSaveTextDocument((document) => void sync.update(document.uri.fsPath)),
  );
}
