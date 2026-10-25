// Registers the outline of LaTeX sources that belong to a writing project.
import * as vscode from "vscode";

import { type LatexProjectSources, toVscodeRange } from "../project/index.js";
import { scanLatexSource } from "@labshelf/core";
import { nestedSymbols } from "../../writing/outline/index.js";

export function sectionSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const { sections } = scanLatexSource(text);
  return nestedSymbols(
    sections.map((section) => ({
      level: section.level,
      name: section.title || "(untitled)",
      // Levels run from part (-1) to subparagraph (5).
      depth: section.level + 1,
      selection: toVscodeRange(section.range),
    })),
    endOfFile,
  );
}

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
