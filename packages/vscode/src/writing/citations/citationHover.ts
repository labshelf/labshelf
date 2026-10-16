// Shows the library paper behind a cited key when the cursor rests on it.
import * as vscode from "vscode";

import { citedKeys } from "@labshelf/core";
import { citingProject, type CitationWorkspace } from "./citationWorkspace.js";
import { paperHover } from "./paperHover.js";

export class CitationHoverProvider implements vscode.HoverProvider {
  constructor(private readonly workspace: CitationWorkspace) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const project = citingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return undefined; }
    const offset = document.offsetAt(position);
    const cited = citedKeys(project.settings.format, document.getText())
      .find((candidate) => candidate.start <= offset && offset <= candidate.end);
    if (!cited) { return undefined; }
    const paper = (await session.listPapers()).find((candidate) => candidate.citeKey === cited.key);
    if (!paper) { return undefined; }
    const range = new vscode.Range(document.positionAt(cited.start), document.positionAt(cited.end));
    return new vscode.Hover(paperHover(paper), range);
  }
}
