// Shares a library folder as a link from the browser: the rights notice and annotations choice, the upload's progress, then the link.
import {
  PAPERS_DIR, relayBackendFor, shareableFolders, shareFolderAsLink, shareRightsNotice, SHARE_WITH_ANNOTATIONS, SHARE_WITHOUT_ANNOTATIONS,
  copiedLinkText, SHARE_STAGE_TEXT, type ShareableFolder,
} from "@labshelf/core";
import { showDialog } from "@labshelf/core/dom";
import { LOG_MODULE, openLinkInTab, reportShareFailure, type ShareLinkPage } from "./shareLinkPage";

async function askAnnotations(folder: ShareableFolder): Promise<boolean | undefined> {
  const notice = shareRightsNotice(folder);
  const choice = await showDialog({
    title: notice.message, message: notice.detail, severity: "warning",
    buttons: [{ id: "without", label: SHARE_WITHOUT_ANNOTATIONS }, { id: "with", label: SHARE_WITH_ANNOTATIONS, primary: true }],
  });
  return choice === undefined ? undefined : choice === "with";
}

async function copied(page: ShareLinkPage, link: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch (error) {
    // PLATFORM: the clipboard refuses a write once the page lost focus during the upload; the dialog's button copies instead.
    await page.logger.log("WARN", LOG_MODULE, "Could not copy the share link", { error: String(error) });
    return false;
  }
}

/** Offers the link once it is on the relay: copied already when the clipboard allowed it, otherwise by the Copy Link button. */
async function offerLink(page: ShareLinkPage, folder: ShareableFolder, link: string): Promise<void> {
  const wasCopied = await copied(page, link);
  const choice = await showDialog({
    title: wasCopied ? `Copied the link to "${folder.label}"` : `The link to "${folder.label}" is ready`,
    message: "Anyone who has it can open these papers, until you revoke it in Manage Shared Links.",
    severity: "info",
    buttons: [...(wasCopied ? [] : [{ id: "copy" as const, label: "Copy Link" }]), { id: "open" as const, label: "Open Link", primary: wasCopied }],
  });
  if (choice === "open") openLinkInTab(link);
  if (choice === "copy") {
    if (await copied(page, link)) page.notice("ok", copiedLinkText(folder.label));
    else page.notice("error", "The browser refused the copy; copy the link from Manage Shared Links.");
  }
}

/** `dir` is the folder's library path (`papers/…`). */
export async function shareFolderFlow(page: ShareLinkPage, dir: string): Promise<void> {
  const papers = page.papers();
  const folder = shareableFolders(papers, PAPERS_DIR, "/").find((candidate) => candidate.dir === dir);
  if (!folder) { page.notice("info", "This folder holds no papers to share."); return; }
  const account = await page.relay.requireRelay();
  const withAnnotations = account && (await askAnnotations(folder));
  if (!account || withAnnotations === undefined) return;
  const context = { folder: folder.dir, papers: folder.count, withAnnotations, relayUrl: account.relayUrl };
  let link: string;
  try {
    link = await shareFolderAsLink({
      papers, folder: folder.dir, withAnnotations, relayUrl: account.relayUrl, backendFor: relayBackendFor(account), registry: page.registry,
      logger: page.logger, sources: page.sources, onStage: (stage) => page.progress(`Sharing "${folder.label}": ${SHARE_STAGE_TEXT[stage]}`),
    });
  } catch (error) {
    reportShareFailure(page, `share "${folder.label}"`, error, context);
    return;
  } finally {
    page.progress(null);
  }
  await offerLink(page, folder, link);
}
