// Shares a library folder as a link: the rights notice and annotations choice, then reading, encrypting and uploading its papers.
import * as vscode from "vscode";

import {
  relayBackendFor, shareableFolders, shareFolderAsLink, shareRightsNotice, SHARE_WITH_ANNOTATIONS, SHARE_WITHOUT_ANNOTATIONS,
  type PaperRecord, type ShareableFolder, type ShareFolderStage,
} from "@labshelf/core";
import type { ActiveServices } from "../../commands/index.js";
import { connectedRelay, LOG_MODULE, reportShareFailure, shareRegistry, type ShareLinkHost } from "./shareLinkHost.js";

export const SHARE_FOLDER_COMMAND = "labshelf.share.folder";

const STAGE_TEXT: Record<ShareFolderStage, string> = { reading: "reading papers…", encrypting: "encrypting…", uploading: "uploading…" };

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
  const notice = shareRightsNotice(folder);
  const choice = await vscode.window.showWarningMessage(notice.message, { modal: true, detail: notice.detail }, SHARE_WITH_ANNOTATIONS, SHARE_WITHOUT_ANNOTATIONS);
  return choice === undefined ? undefined : choice === SHARE_WITH_ANNOTATIONS;
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
    const { link, summary } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Sharing "${folder.label}"` }, (progress) =>
      shareFolderAsLink({
        papers, folder: folder.dir, withAnnotations, relayUrl: account.relayUrl, backendFor: relayBackendFor(account), registry, logger: services.logger,
        sources: { fs, paths, annotations: (paperId) => services.paperDataStore.getAnnotations(paperId) },
        onStage: (stage) => progress.report({ message: STAGE_TEXT[stage] }),
      }));
    await vscode.env.clipboard.writeText(link);
    await services.logger.log("INFO", LOG_MODULE, "Shared a folder as a link", summary);
    const open = "Open Link";
    const choice = await vscode.window.showInformationMessage(`Copied the link to "${folder.label}". Anyone who has it can open these papers.`, open);
    if (choice === open) { await vscode.env.openExternal(vscode.Uri.parse(link)); }
  } catch (error) {
    reportShareFailure(services.logger, `share "${folder.label}"`, error, context);
  }
}
