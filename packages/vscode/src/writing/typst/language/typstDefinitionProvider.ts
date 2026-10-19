// Adapts the Typst language service's go-to-definition to a VS Code location in the project file.
import * as vscode from "vscode";

import type { TypstContextOf } from "./typstDocumentContext.js";

export function createTypstDefinitionProvider(contextOf: TypstContextOf): vscode.DefinitionProvider {
  return {
    async provideDefinition(document, position) {
      const { service, path, root } = contextOf(document);
      const text = document.getText();
      const result = await service.definition(path, text, document.offsetAt(position));
      if (!result || !root) { return undefined; }
      const uri = vscode.Uri.joinPath(root, ...result.path.split("/"));
      // The definition's file may not be open; its offsets map to positions only through its text.
      const target = result.path === path ? document : await vscode.workspace.openTextDocument(uri);
      return new vscode.Location(uri, new vscode.Range(target.positionAt(result.from), target.positionAt(result.to)));
    },
  };
}
