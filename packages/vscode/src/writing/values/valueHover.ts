// Shows the value behind an `\lsvalue` key or a Typst json() member, with the file and path it comes from.
import * as vscode from "vscode";

import { latexValueAt, typstValueAt, type ValueLeaf } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";
import type { ProjectValues } from "./projectValues.js";
import { listedValueFile } from "./typstValueFile.js";

function leafHover(leaf: ValueLeaf): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.appendText(String(leaf.value));
  markdown.appendMarkdown("\n\n");
  markdown.appendText(`${leaf.file} → ${leaf.path}`);
  return markdown;
}

function unknownHover(name: string): vscode.MarkdownString {
  return new vscode.MarkdownString().appendText(`No value "${name}" in the files listed under values in labshelf.yaml.`);
}

export class ValueHoverProvider implements vscode.HoverProvider {
  constructor(private readonly values: ProjectValues) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const project = this.values.sourceProject(document.uri.fsPath);
    if (!project) { return undefined; }
    const offset = document.offsetAt(position);
    const leaves = await this.values.leaves(project);
    const found = project.settings.format === "latex"
      ? this.latex(document, offset, leaves)
      : this.typst(project, document, offset, leaves);
    return found && new vscode.Hover(found.contents, new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)));
  }

  private latex(document: vscode.TextDocument, offset: number, leaves: readonly ValueLeaf[]) {
    const reference = latexValueAt(document.getText(), offset);
    if (!reference) { return undefined; }
    const leaf = leaves.find((candidate) => candidate.key === reference.key);
    return { ...reference, contents: leaf ? leafHover(leaf) : unknownHover(reference.key) };
  }

  private typst(project: ReadyProject, document: vscode.TextDocument, offset: number, leaves: readonly ValueLeaf[]) {
    const reference = typstValueAt(document.getText(), offset);
    const file = reference && listedValueFile(this.values.paths, project, document.uri.fsPath, reference.source);
    if (!reference || file === undefined) { return undefined; }
    const leaf = leaves.find((candidate) => candidate.file === file && candidate.path === reference.path);
    // A member that holds more members has no single value to show.
    if (!leaf && leaves.some((candidate) => candidate.file === file && candidate.path.startsWith(`${reference.path}.`))) { return undefined; }
    return { ...reference, contents: leaf ? leafHover(leaf) : unknownHover(reference.path) };
  }
}
