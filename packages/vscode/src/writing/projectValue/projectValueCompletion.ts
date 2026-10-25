// Completes `\lsvalue{` keys in LaTeX and the members of json() values in Typst from the project's value files.
import * as vscode from "vscode";

import { latexKeyStart, typstValuePrefix, valueMembers, type ValueLeaf } from "@labshelf/core";
import type { ReadyProject } from "../buildRootDocument.js";
import type { ProjectValues } from "./projectValues.js";
import { listedValueFile } from "./typstProjectValueFile.js";

function item(label: string, leaf: ValueLeaf | undefined, file: string, range: vscode.Range): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(label, leaf ? vscode.CompletionItemKind.Value : vscode.CompletionItemKind.Field);
  if (leaf) { completion.detail = String(leaf.value); }
  completion.documentation = file;
  completion.insertText = label;
  completion.range = range;
  return completion;
}

export class ValueCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly values: ProjectValues) {}

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const project = this.values.sourceProject(document.uri.fsPath);
    if (!project) { return undefined; }
    return project.settings.format === "latex"
      ? this.latexKeys(project, document, position)
      : this.typstMembers(project, document, position);
  }

  private async latexKeys(project: ReadyProject, document: vscode.TextDocument, position: vscode.Position) {
    const start = latexKeyStart(document.lineAt(position.line).text.slice(0, position.character));
    if (start === undefined) { return undefined; }
    const range = new vscode.Range(position.line, start, position.line, position.character);
    return (await this.values.leaves(project)).map((leaf) => item(leaf.key, leaf, leaf.file, range));
  }

  private async typstMembers(project: ReadyProject, document: vscode.TextDocument, position: vscode.Position) {
    const typing = typstValuePrefix(document.getText(), document.offsetAt(position));
    const file = typing && listedValueFile(this.values.paths, project, document.uri.fsPath, typing.source);
    if (!typing || file === undefined) { return undefined; }
    const range = new vscode.Range(document.positionAt(typing.start), position);
    return valueMembers(await this.values.leaves(project), file, typing.parent).map((member) => item(member.name, member.leaf, file, range));
  }
}
