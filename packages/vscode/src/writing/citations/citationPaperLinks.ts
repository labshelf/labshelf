// Turns each cited key that names a library paper into a Ctrl+click link to the reader.
import * as vscode from "vscode";

import { citedKeys } from "@labshelf/core";
import { citingProject, type CitationWorkspace } from "./citationWorkspace.js";

// A definition provider must answer with a source Location, so the paper opens through a document link.
export class CitationLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly workspace: CitationWorkspace) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const project = citingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return []; }
    const papers = new Map((await session.listPapers()).map((paper) => [paper.citeKey, paper]));
    return citedKeys(project.settings.format, document.getText()).flatMap((cited) => {
      const paper = papers.get(cited.key);
      if (!paper) { return []; }
      const range = new vscode.Range(document.positionAt(cited.start), document.positionAt(cited.end));
      const link = new vscode.DocumentLink(range, vscode.Uri.parse(`command:labshelf.openPdfViewer?${encodeURIComponent(JSON.stringify([paper.id]))}`));
      link.tooltip = "Open in LabShelf reader";
      return [link];
    });
  }
}
