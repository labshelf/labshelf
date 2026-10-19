// Provides the outline of .typ files from LabShelf's Typst scanner.
import * as vscode from "vscode";

import { typstSymbols } from "./typstSymbols.js";

export function registerTypstOutline(): vscode.Disposable {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      const text = document.getText();
      return typstSymbols(text, document.positionAt(text.length));
    },
  };
  return vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.typ" }, provider);
}
