// Completes the label names inside a `\ref`-family command from every label of the project.
import * as vscode from "vscode";

import { scanLatexSource } from "@labshelf/core";
import type { LatexProjectSources } from "../project/index.js";
import { projectLabels } from "./projectLabels.js";

/**
 * The column where the label name being typed starts, when the cursor sits inside the braces of a ref command.
 * The scanner drops empty names, so a stand-in letter and a closing brace are appended to make it yield one.
 */
function partialRefStart(linePrefix: string): number | undefined {
  const { refs } = scanLatexSource(`${linePrefix}x}`);
  const typing = refs.find((ref) => ref.range.end.line === 0 && ref.range.end.character === linePrefix.length + 1);
  return typing?.range.start.character;
}

export class RefCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly sources: LatexProjectSources) {}

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    const start = partialRefStart(prefix);
    if (start === undefined) { return undefined; }
    const project = await this.sources.projectSourcesFor(document);
    if (!project) { return undefined; }
    const range = new vscode.Range(position.line, start, position.line, position.character);
    const seen = new Set<string>();
    const items: vscode.CompletionItem[] = [];
    for (const label of projectLabels(project)) {
      if (seen.has(label.name)) { continue; }
      seen.add(label.name);
      const item = new vscode.CompletionItem(label.name, vscode.CompletionItemKind.Reference);
      item.detail = `${label.path}:${label.range.start.line + 1}`;
      item.documentation = label.line;
      item.range = range;
      items.push(item);
    }
    return items;
  }
}
