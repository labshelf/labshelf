// Provides the outline of .typ files until the Typst language server runs and provides it.
import * as vscode from "vscode";

import { languageServerRunning } from "../typst/index.js";
import { typstSymbols } from "./typstSymbols.js";

export function registerTypstOutline(): vscode.Disposable {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      if (languageServerRunning()) { return []; }
      const text = document.getText();
      return typstSymbols(text, document.positionAt(text.length));
    },
  };
  return vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.typ" }, provider);
}
