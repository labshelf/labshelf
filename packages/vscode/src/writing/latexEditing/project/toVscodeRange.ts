// Converts a core LaTeX source range to a VS Code range.
import * as vscode from "vscode";

import type { LatexRange } from "@labshelf/core";

export function toVscodeRange(range: LatexRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}
