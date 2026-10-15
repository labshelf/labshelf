// Registers the outline of LaTeX sources that belong to a writing project.
import * as vscode from "vscode";

import type { LatexProjectSources } from "../project/index.js";
import { sectionSymbols } from "./sectionSymbols.js";

export function registerSectionOutline(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      if (!sources.projectOf(document.uri)) { return undefined; }
      const text = document.getText();
      return sectionSymbols(text, document.positionAt(text.length));
    },
  };
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.tex" }, provider));
}
