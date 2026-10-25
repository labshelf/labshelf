// Lists the sections of a LaTeX source as document symbols nested by heading level.
import type * as vscode from "vscode";

import { scanLatexSource } from "@labshelf/core";
import { nestedSymbols } from "../../writing/outline/index.js";
import { toVscodeRange } from "../project/index.js";

export function sectionSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const { sections } = scanLatexSource(text);
  return nestedSymbols(
    sections.map((section) => ({
      level: section.level,
      name: section.title || "(untitled)",
      // Levels run from part (-1) to subparagraph (5).
      depth: section.level + 1,
      selection: toVscodeRange(section.range),
    })),
    endOfFile,
  );
}
