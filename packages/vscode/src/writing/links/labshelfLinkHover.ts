// Shows the paper behind a labshelf: link, or that no paper has its key, when the cursor rests on it.
import * as vscode from "vscode";

import { paperHover } from "../citations/index.js";
import { findPaperLinks, type LinkLibrary } from "./findPaperLinks.js";

export class LabshelfLinkHoverProvider implements vscode.HoverProvider {
  constructor(private readonly library: LinkLibrary) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const found = (await findPaperLinks(this.library, document)).find(({ range }) => range.contains(position));
    if (!found) { return undefined; }
    const contents = found.paper
      ? paperHover(found.paper)
      : new vscode.MarkdownString(`No paper in the library has key \`${found.link.citeKey}\`.`);
    return new vscode.Hover(contents, found.range);
  }
}
