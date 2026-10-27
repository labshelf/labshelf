// Registers the outline of LaTeX sources that belong to a writing project.
import * as vscode from "vscode";

import { type LatexProjectSources, deriveVscodeRange } from "./project/index.js";
import { scanLatexSource } from "@labshelf/core";
import { deriveNestedSymbols } from "../writing/projects/index.js";

export function listSectionSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const { sections } = scanLatexSource(text);
  return deriveNestedSymbols(
    sections.map((section) => ({
      level: section.level,
      name: section.title || "(untitled)",
      // Levels run from part (-1) to subparagraph (5).
      depth: section.level + 1,
      selection: deriveVscodeRange(section.range),
    })),
    endOfFile,
  );
}

export function registerSectionOutline(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      if (!sources.projectOf(document.uri)) { return undefined; }
      const text = document.getText();
      return listSectionSymbols(text, document.positionAt(text.length));
    },
  };
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.tex" }, provider));
}
