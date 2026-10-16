// Provides the outline of .typ files when Tinymist is not installed to provide it.
import * as vscode from "vscode";

import { tinymistInstalled } from "../typst/tinymist/index.js";
import { typstSymbols } from "./typstSymbols.js";

export function registerTypstOutline(): vscode.Disposable {
  if (tinymistInstalled()) { return new vscode.Disposable(() => {}); }
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      const text = document.getText();
      return typstSymbols(text, document.positionAt(text.length));
    },
  };
  return vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.typ" }, provider);
}
