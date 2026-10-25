// Replaces one cited key on a source line, leaving the other keys of the same cite untouched.
import * as vscode from "vscode";

import type { CitationFix, ILogger, PathOps } from "@labshelf/core";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";

export interface ReplaceCiteKeyDeps {
  projectFolder: string;
  paths: PathOps;
  logger: ILogger;
}

const LATEX_CITE = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;

/** Column range of `key` inside a LaTeX cite argument list or as a Typst `@key` / `<key>`. */
function keyRange(line: string, key: string): [number, number] | undefined {
  for (const cite of line.matchAll(LATEX_CITE)) {
    const keys = cite[1] ?? "";
    const listStart = cite.index + cite[0].length - 1 - keys.length;
    for (const item of keys.matchAll(/[^,\s]+/g)) {
      if (item[0] === key) { return [listStart + item.index, listStart + item.index + key.length]; }
    }
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const typst = new RegExp(`(?<![\\w@])(?:@|<)(${escaped})(?![\\w:-])`).exec(line);
  return typst ? [typst.index + 1, typst.index + 1 + key.length] : undefined;
}

export async function updateCiteKey(deps: ReplaceCiteKeyDeps, fix: Extract<CitationFix, { kind: "replace" }>): Promise<void> {
  const uri = vscode.Uri.file(deps.paths.join(deps.projectFolder, fix.file));
  const document = await vscode.workspace.openTextDocument(uri);
  const lineIndex = fix.line - 1;
  const range = lineIndex >= 0 && lineIndex < document.lineCount ? keyRange(document.lineAt(lineIndex).text, fix.key) : undefined;
  if (!range) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Cited key not found on the line to fix", { file: fix.file, line: fix.line, key: fix.key });
    void vscode.window.showWarningMessage(`Could not find the citation "${fix.key}" at ${fix.file}:${fix.line}.`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(lineIndex, range[0], lineIndex, range[1]), fix.replacement);
  await vscode.workspace.applyEdit(edit);
}
