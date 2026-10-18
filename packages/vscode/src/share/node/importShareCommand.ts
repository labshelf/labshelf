// Copies the papers of a share link into the library, in a new folder named after the shared one, with progress and a summary.
import { IMPORT_SHARE_COMMAND } from "../importShareCommandId.js";
import * as vscode from "vscode";

import {
  createWorkerShareReader, importSharedPapers, openShare, parseShareLink, SHARE_PAGE_ORIGIN, type OpenShareError, type SharedImportSummary,
} from "@labshelf/core";
import { LOG_MODULE, reportShareFailure, type ShareLinkHost } from "./shareLinkHost.js";


const OPEN_FAILURE: Record<OpenShareError, string> = {
  malformedLink: "LabShelf could not read that share link.",
  removed: "This link was removed by the person who shared it.",
  unreadable: "The link's key does not open this share; check that the link was copied whole.",
  network: "LabShelf could not reach the relay that serves this share.",
};

function summaryText(summary: SharedImportSummary, folderName: string, withAnnotations: boolean): string {
  const parts = [summary.added.length > 0 ? `Imported ${summary.added.length} of the shared papers into "${folderName}".` : "Every shared paper is already in your library."];
  if (summary.added.length > 0 && summary.duplicates.length > 0) { parts.push(`${summary.duplicates.length} already in your library.`); }
  if (summary.missingPdfs.length > 0) { parts.push(`${summary.missingPdfs.length} without their PDF, which the relay could not serve.`); }
  // The sidecar store adds annotations only as new ones of the reader, so shared annotations are not copied.
  if (withAnnotations) { parts.push("Shared annotations are not imported."); }
  return parts.join(" ");
}

async function askLink(): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt: "Paste a share link", placeHolder: `${SHARE_PAGE_ORIGIN}/share/#…`, ignoreFocusOut: true });
}

/** `link` is the share link text, from the vscode:// URI of the share page or the command palette. */
export async function importShare(host: ShareLinkHost, link?: unknown): Promise<void> {
  const text = typeof link === "string" ? link : await askLink();
  if (!text) { return; }
  const services = await host.requireServices();
  if (!services) { return; }
  const parsed = parseShareLink(text);
  if (!parsed.ok) {
    await services.logger.log("WARN", LOG_MODULE, "Refused a share link that does not parse", { error: parsed.error });
    void vscode.window.showWarningMessage(`${OPEN_FAILURE.malformedLink} (${parsed.error})`);
    return;
  }
  const context = { shareId: parsed.link.shareId, relayUrl: parsed.link.relayUrl };
  try {
    const done = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Importing shared papers" }, async (progress) => {
      const opened = await openShare(text, (relayUrl) => createWorkerShareReader({ relayUrl }));
      if (!opened.ok) {
        await services.logger.log("WARN", LOG_MODULE, "Could not open a share link", { ...context, error: opened.error, detail: opened.detail });
        void vscode.window.showWarningMessage(OPEN_FAILURE[opened.error]);
        return undefined;
      }
      const { manifest } = opened.share;
      const summary = await importSharedPapers({
        ctx: services.mutations, share: opened.share, parentDir: services.mutations.papersRoot, known: await services.paperService.listPapers(),
        onProgress: (count, total) => progress.report({ message: `${count} of ${total}`, increment: 100 / total }),
      });
      if (summary.added.length > 0) { await services.reindexLibrary(); }
      return { summary, withAnnotations: manifest.papers.some((paper) => (paper.annotations?.length ?? 0) > 0) };
    });
    if (!done) { return; }
    const { folder } = done.summary;
    const folderName = folder ? services.mutations.paths.basename(folder) : "";
    const show = "Open Folder";
    const choice = await vscode.window.showInformationMessage(summaryText(done.summary, folderName, done.withAnnotations), ...(folder ? [show] : []));
    if (choice === show && folder) { await vscode.commands.executeCommand("labshelf.openListTab", { label: folderName, dirPath: folder }); }
  } catch (error) {
    reportShareFailure(services.logger, "import the shared papers", error, context);
  }
}
