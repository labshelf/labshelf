// Adapts the Typst language service's hover to a VS Code hover.
import * as vscode from "vscode";

import type { TypstContextOf } from "./typstDocumentContext.js";

export function createTypstHoverProvider(contextOf: TypstContextOf): vscode.HoverProvider {
  return {
    async provideHover(document, position) {
      const { service, path } = contextOf(document);
      const result = await service.hover(path, document.getText(), document.offsetAt(position));
      if (!result) { return undefined; }
      const range = new vscode.Range(document.positionAt(result.from), document.positionAt(result.to));
      return new vscode.Hover(new vscode.MarkdownString(result.text), range);
    },
  };
}
