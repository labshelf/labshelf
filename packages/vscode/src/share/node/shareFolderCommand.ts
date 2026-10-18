// Shares a library folder as a link: the rights notice and annotations choice, then reading, encrypting and uploading its papers.
import * as vscode from "vscode";

import { buildShare, createWorkerShareBackend, uploadShare, type PaperRecord } from "@labshelf/core";
import type { ActiveServices } from "../../commands/index.js";
import { papersInFolder, shareableFolders, sharePaperInputs, type ShareableFolder } from "../index.js";
import { connectedRelay, LOG_MODULE, reportShareFailure, shareRegistry, type ShareLinkHost } from "./shareLinkHost.js";

export const SHARE_FOLDER_COMMAND = "labshelf.share.folder";

const WITH_ANNOTATIONS = "Share with my annotations";
const WITHOUT_ANNOTATIONS = "Share without annotations";

/** A Library view node names its folder; anything else means the user picks one. */
function folderOf(target: unknown, services: ActiveServices): string | undefined {
  if (typeof target !== "object" || target === null || !("dirPath" in target)) { return undefined; }
  const dir = (target as { dirPath: unknown }).dirPath;
  return typeof dir === "string" && dir !== services.mutations.papersRoot ? dir : undefined;
}

async function pickFolder(papers: PaperRecord[], services: ActiveServices, preset: string | undefined): Promise<ShareableFolder | undefined> {
  const folders = shareableFolders(papers, services.mutations.papersRoot, services.mutations.paths.sep);
  const presetFolder = folders.find((folder) => folder.dir === preset);
  if (presetFolder) { return presetFolder; }
  if (folders.length === 0) {
    void vscode.window.showInformationMessage("No folder in the library holds papers to share.");
    return undefined;
  }
  const items = folders.map((folder) => ({ label: folder.label, description: `${folder.count} ${folder.count === 1 ? "paper" : "papers"}`, folder }));
  return (await vscode.window.showQuickPick(items, { placeHolder: "Folder to share as a link" }))?.folder;
}

async function askAnnotations(folder: ShareableFolder): Promise<boolean | undefined> {
  const choice = await vscode.window.showWarningMessage(
    "You are responsible for having the right to share these papers.",
    { modal: true, detail: `Anyone with the link can read the ${folder.count} papers of "${folder.label}" and download their PDFs, until you revoke it.` },
    WITH_ANNOTATIONS, WITHOUT_ANNOTATIONS,
  );
  return choice === undefined ? undefined : choice === WITH_ANNOTATIONS;
}

export async function shareFolder(host: ShareLinkHost, target?: unknown): Promise<void> {
  const services = await host.requireServices();
  const account = services && (await connectedRelay(host, "share links are served by your own relay."));
  const registry = shareRegistry(host);
  if (!services || !account || !registry) { return; }
  const papers = await services.paperService.listPapers();
  const folder = await pickFolder(papers, services, folderOf(target, services));
  const withAnnotations = folder && (await askAnnotations(folder));
  if (!folder || withAnnotations === undefined) { return; }
  const { fs, paths } = services.mutations;
  const context = { folder: folder.dir, papers: folder.count, withAnnotations, relayUrl: account.relayUrl };
  try {
    const link = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Sharing "${folder.label}"` }, async (progress) => {
      progress.report({ message: "reading papers…" });
      const inputs = await sharePaperInputs(papersInFolder(papers, folder.dir, paths.sep), withAnnotations, {
        fs, paths, annotations: (paperId) => services.paperDataStore.getAnnotations(paperId),
      });
      progress.report({ message: "encrypting…" });
      const share = await buildShare({ folderName: paths.basename(folder.dir), papers: inputs, withAnnotations });
      progress.report({ message: "uploading…" });
      const backend = createWorkerShareBackend({ relayUrl: account.relayUrl, ownerSecret: account.ownerSecret });
      return uploadShare({ share, relayUrl: account.relayUrl, backend, registry, logger: services.logger });
    });
    await vscode.env.clipboard.writeText(link);
    await services.logger.log("INFO", LOG_MODULE, "Shared a folder as a link", context);
    const open = "Open Link";
    const choice = await vscode.window.showInformationMessage(`Copied the link to "${folder.label}". Anyone who has it can open these papers.`, open);
    if (choice === open) { await vscode.env.openExternal(vscode.Uri.parse(link)); }
  } catch (error) {
    reportShareFailure(services.logger, `share "${folder.label}"`, error, context);
  }
}
