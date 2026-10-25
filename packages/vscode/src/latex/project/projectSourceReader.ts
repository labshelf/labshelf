// Reads a project's LaTeX files from the editors that hold them open, else from disk.
import * as vscode from "vscode";

import type { ILogger, ProjectSourceReader } from "@labshelf/core";

const MISSING_CODES = new Set(["FileNotFound", "ENOENT"]);

export function createProjectSourceReader(root: vscode.Uri, logger: () => ILogger | undefined): ProjectSourceReader {
  return {
    async read(relativePath) {
      const uri = vscode.Uri.joinPath(root, relativePath);
      // Unsaved text wins so labels and macros follow what the user is typing.
      const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === uri.fsPath);
      if (open) { return open.getText(); }
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch (error) {
        if (!MISSING_CODES.has((error as { code?: string }).code ?? "")) {
          await logger()?.error("writing/latex-editing", error, { action: "read", file: uri.fsPath });
        }
        return undefined;
      }
    },
  };
}
