// Lists the headings of a Typst source as document symbols nested by heading level.
import * as vscode from "vscode";

import { scanTypstHeadings } from "@labshelf/core/typst";
import { nestedSymbols } from "./nestedSymbols.js";

export function typstSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const lines = text.split("\n");
  const entries = scanTypstHeadings(text).map((heading) => ({
    level: heading.level,
    name: heading.title || "(untitled)",
    depth: heading.level - 1,
    selection: new vscode.Range(heading.line, 0, heading.line, lines[heading.line]?.length ?? 0),
  }));
  return nestedSymbols(entries, endOfFile);
}
