// Copies the papers of a share link into the library, in a new folder named after the shared one, with progress and a summary.
import * as vscode from "vscode";

import {
  createWorkerShareReader, importShareLink, OPEN_SHARE_FAILURE, refusedShareLinkText, SHARE_PAGE_ORIGIN, shareImportSummaryText,
} from "@labshelf/core";
import { reportShareFailure, type ShareLinkHost } from "./shareLinkHost.js";

async function askLink(): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt: "Paste a share link", placeHolder: `${SHARE_PAGE_ORIGIN}/share/#…`, ignoreFocusOut: true });
}

/** `link` is the share link text, from the vscode:// URI of the share page or the command palette. */
export async function importShare(host: ShareLinkHost, link?: unknown): Promise<void> {
  const text = typeof link === "string" ? link : await askLink();
  if (!text) { return; }
  const services = await host.requireServices();
  if (!services) { return; }
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Importing shared papers" }, async (progress) => {
      const imported = await importShareLink({
        text, ctx: services.mutations, parentDir: services.mutations.papersRoot, known: await services.paperService.listPapers(),
        readerFor: (relayUrl) => createWorkerShareReader({ relayUrl }),
        onProgress: (count, total) => progress.report({ message: `${count} of ${total}`, increment: 100 / total }),
      });
      if (imported.status === "imported" && imported.summary.added.length > 0) { await services.reindexLibrary(); }
      return imported;
    });
    if (result.status === "refused") {
      void vscode.window.showWarningMessage(refusedShareLinkText(result.error));
      return;
    }
    if (result.status === "openFailed") {
      void vscode.window.showWarningMessage(OPEN_SHARE_FAILURE[result.error]);
      return;
    }
    const { folder } = result.summary;
    const folderName = folder ? services.mutations.paths.basename(folder) : "";
    const show = "Open Folder";
    const choice = await vscode.window.showInformationMessage(shareImportSummaryText(result.summary, folderName, result.withAnnotations), ...(folder ? [show] : []));
    if (choice === show && folder) { await vscode.commands.executeCommand("labshelf.openListTab", { label: folderName, dirPath: folder }); }
  } catch (error) {
    reportShareFailure(services.logger, "import the shared papers", error, {});
  }
}
