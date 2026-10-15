// Lists the sections of a LaTeX source as document symbols nested by heading level.
import * as vscode from "vscode";

import { scanLatexSource, type SectionFact } from "@labshelf/core";
import { toVscodeRange } from "../project/index.js";

// Levels run from part (-1) to subparagraph (5).
const KIND_BY_LEVEL = [
  vscode.SymbolKind.Module, vscode.SymbolKind.Namespace, vscode.SymbolKind.Class, vscode.SymbolKind.Struct,
  vscode.SymbolKind.Field, vscode.SymbolKind.Property, vscode.SymbolKind.Constant,
];

/** A section runs until the next heading of the same or a higher level, or the end of the file. */
function sectionEnd(sections: readonly SectionFact[], index: number, endOfFile: vscode.Position): vscode.Position {
  const level = sections[index]!.level;
  const next = sections.slice(index + 1).find((section) => section.level <= level);
  return next ? toVscodeRange(next.range).start : endOfFile;
}

export function sectionSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const { sections } = scanLatexSource(text);
  const roots: vscode.DocumentSymbol[] = [];
  const open: { level: number; symbol: vscode.DocumentSymbol }[] = [];
  sections.forEach((section, index) => {
    const selection = toVscodeRange(section.range);
    const symbol = new vscode.DocumentSymbol(
      section.title || "(untitled)", "", KIND_BY_LEVEL[section.level + 1]!,
      new vscode.Range(selection.start, sectionEnd(sections, index, endOfFile)), selection,
    );
    while (open.length > 0 && open[open.length - 1]!.level >= section.level) { open.pop(); }
    (open[open.length - 1]?.symbol.children ?? roots).push(symbol);
    open.push({ level: section.level, symbol });
  });
  return roots;
}
