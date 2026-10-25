// Lists the headings of a Typst source as document symbols nested by heading level.
import * as vscode from "vscode";

import { scanTypstHeadings } from "@labshelf/core/typst";
import { deriveNestedSymbols } from "./nestOutline.js";

export function listTypstSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const lines = text.split("\n");
  const entries = scanTypstHeadings(text).map((heading) => ({
    level: heading.level,
    name: heading.title || "(untitled)",
    depth: heading.level - 1,
    selection: new vscode.Range(heading.line, 0, heading.line, lines[heading.line]?.length ?? 0),
  }));
  return deriveNestedSymbols(entries, endOfFile);
}
