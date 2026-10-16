// Turns each labshelf: link to a library paper into a Ctrl+click link that opens the reader at its page.
import * as vscode from "vscode";

import { findPaperLinks, type LinkLibrary } from "./findPaperLinks.js";

export class LabshelfLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly library: LinkLibrary) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const links = await findPaperLinks(this.library, document);
    return links.flatMap(({ range, link, paper }) => {
      if (!paper) { return []; }
      const args = link.page === undefined ? [paper.id] : [paper.id, link.page];
      const target = vscode.Uri.parse(`command:labshelf.openPdfViewer?${encodeURIComponent(JSON.stringify(args))}`);
      const documentLink = new vscode.DocumentLink(range, target);
      documentLink.tooltip = link.page === undefined ? "Open in LabShelf reader" : `Open in LabShelf reader, page ${link.page}`;
      return [documentLink];
    });
  }
}
