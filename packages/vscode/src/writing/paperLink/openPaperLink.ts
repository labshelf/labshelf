// Opens the reader at a page for a vscode://<extension id>/open?link=<labshelf link> URI, and hands share imports on.
import * as vscode from "vscode";

import { papersByCiteKey, parseLabshelfLink, SHARE_IMPORT_PATH } from "@labshelf/core";
import { IMPORT_SHARE_COMMAND } from "../../share/index.js";
import type { LinkLibrary } from "./findPaperLinks.js";

const LOG_MODULE = "LabshelfLinks";

export class LabshelfUriHandler implements vscode.UriHandler {
  constructor(private readonly library: LinkLibrary) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    // CONTRACT: documents/contracts/share-link.md#open-in-labshelf
    if (uri.path === SHARE_IMPORT_PATH) {
      await vscode.commands.executeCommand(IMPORT_SHARE_COMMAND, new URLSearchParams(uri.query).get("link") ?? undefined);
      return;
    }
    const session = this.library.session();
    if (!session) {
      await vscode.window.showWarningMessage("Open a LabShelf library before following a labshelf: link.");
      return;
    }
    const text = uri.path === "/open" ? new URLSearchParams(uri.query).get("link") : null;
    const link = text === null ? undefined : parseLabshelfLink(text);
    if (!link) {
      await session.logger.log("WARN", LOG_MODULE, "Ignored a URI that is not a labshelf: link", { path: uri.path, query: uri.query });
      await vscode.window.showWarningMessage("LabShelf could not read that link. Expected labshelf:<cite key>[#p<page>].");
      return;
    }
    try {
      // The key comes from outside, and resolvePaper opens a quick pick for ids it does not know.
      const paper = papersByCiteKey(await session.listPapers()).get(link.citeKey);
      if (!paper) {
        await session.logger.log("WARN", LOG_MODULE, "Link names a key that no paper has", { citeKey: link.citeKey });
        await vscode.window.showWarningMessage(`No paper in the library has the key "${link.citeKey}".`);
        return;
      }
      const args = link.page === undefined ? [paper.id] : [paper.id, link.page];
      await vscode.commands.executeCommand("labshelf.openPdfViewer", ...args);
      await session.logger.log("INFO", LOG_MODULE, "Opened paper from a labshelf: URI", { paperId: paper.id, page: link.page });
    } catch (error) {
      await session.logger.error(LOG_MODULE, error, { citeKey: link.citeKey });
    }
  }
}
