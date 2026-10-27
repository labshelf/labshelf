// Shows the share-link dialogs: share a folder, import a link, manage the links made, and the shared failure reporter.
import { askInputBox, openProgressDialog, pickQuickEntry, showDialog, showToast } from "../../ui/dom/index.js";
import type { ShareHost, ShareLinkImportResult, ShareLinkView, ShareProgress } from "../index.js";
import { parseShareLink } from "../shareLink.js";
import {
  SHARE_STAGE_TEXT, SHARE_WITHOUT_ANNOTATIONS, SHARE_WITH_ANNOTATIONS,
  describeCopiedShareLink, describeRefusedShareLink, describeRevokeShareNotice, describeRevokeShareOutcome,
  describeShareFailure, describeShareRightsNotice,
} from "../folderShare.js";

/** Shows an informational dialog with a single OK button. */
export async function showNoticeDialog(title: string, message: string, severity: "info" | "warning" = "info"): Promise<void> {
  await showDialog({ title, message, severity, buttons: [{ id: "ok", label: "OK", primary: true }] });
}

/** Runs a sharing action and shows any rejection as an error toast. `action` completes "LabShelf could not …", for example "share the project". */
export async function reportFailure(action: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    showToast(describeShareFailure(action, error), "error");
  }
}

// Share a folder: rights notice, progress, then the link.

export function runShareFolderDialog(host: ShareHost, path: string): Promise<void> {
  return reportFailure("share the folder", async () => {
    const folder = await host.shareableFolder(path);
    if (!folder) { showToast("This folder holds no papers to share.", "info"); return; }
    const notice = describeShareRightsNotice(folder);
    const choice = await showDialog({
      title: notice.message,
      message: notice.detail,
      buttons: [
        { id: "without", label: SHARE_WITHOUT_ANNOTATIONS },
        { id: "with", label: SHARE_WITH_ANNOTATIONS, primary: true },
      ],
    });
    if (!choice) return;
    const progress = openProgressDialog({ title: `Sharing "${folder.label}"`, message: `Sharing "${folder.label}"…` });
    let result;
    try {
      result = await host.shareFolder(path, choice === "with", (p: ShareProgress) => {
        if ("stage" in p) progress.update(`Sharing "${folder.label}": ${SHARE_STAGE_TEXT[p.stage]}`);
      });
    } finally {
      progress.close();
    }
    if (result.kind === "noRelay") {
      await showNoticeDialog("Connect Cloudflare to share", "Share links live on your Cloudflare relay. Connect Cloudflare to share a folder.");
      return;
    }
    await showLink(host, folder.label, result.link);
  });
}

async function showLink(host: ShareHost, label: string, link: string): Promise<void> {
  const copied = await host.copyText(link);
  const choice = await showDialog({
    title: copied ? `Copied the link to "${label}"` : `The link to "${label}" is ready`,
    message: `${copied ? "" : `${link}\n\n`}Anyone who has it can open these papers, until you revoke it in Manage Shared Links.`,
    severity: "info",
    buttons: [
      ...(copied ? [] : [{ id: "copy" as const, label: "Copy Link" }]),
      { id: "open" as const, label: "Open Link", primary: true },
    ],
  });
  if (choice === "open") await host.openLink(link);
  else if (choice === "copy") {
    const again = await host.copyText(link);
    showToast(again ? describeCopiedShareLink(label) : "The clipboard refused the copy; select the link and copy it.", again ? "ok" : "error");
  }
}

// Import a link: asks for the link, shows progress, then offers the new folder.

export function runImportShareLinkDialog(host: ShareHost, link?: string): Promise<void> {
  return reportFailure("import the shared link", async () => {
    const text = link ?? await askInputBox({
      title: "Import Shared Link",
      prompt: "Paste a share link",
      validate: linkProblem,
    });
    if (!text) return;
    const progress = openProgressDialog({ title: "Importing shared papers", message: "Importing shared papers…" });
    let result: ShareLinkImportResult;
    try {
      result = await host.importLink(text, (p) => {
        if ("done" in p) progress.update(`Importing shared papers: ${p.done} of ${p.total}`);
      });
    } finally {
      progress.close();
    }
    if (result.kind === "failed") { await showNoticeDialog("Could not import the link", result.message, "warning"); return; }
    if (!result.folder) { showToast(result.summary, "info"); return; }
    const folder = result.folder;
    const choice = await showDialog({
      title: "Imported the shared papers",
      message: result.summary,
      severity: "info",
      buttons: [{ id: "open", label: "Open Folder", primary: true }],
    });
    if (choice === "open") await host.openFolder(folder);
  });
}

function linkProblem(text: string): string | null {
  if (text.trim() === "") return "Paste a share link";
  const parsed = parseShareLink(text);
  return parsed.ok ? null : describeRefusedShareLink(parsed.error);
}

// Manage links: lists the links this host made and lets the user copy, open or revoke one.

type LinkAction = "copy" | "open" | "revoke";

export function runManageShareLinksDialog(host: ShareHost): Promise<void> {
  return reportFailure("manage the shared links", async () => {
    const links = await host.sharedLinks();
    if (links.length === 0) { showToast(`No folder of this library is shared as a link from ${host.place}.`, "info"); return; }
    const link = await pickQuickEntry(
      links.map((l) => ({ label: l.folder, description: `${new Date(l.createdAt).toLocaleString()} · ${l.relayHost}`, icon: "link" as const, value: l })),
      { title: "Shared Links", placeholder: "Pick a shared folder" },
    );
    if (!link) return;
    const action = await pickQuickEntry<LinkAction>([
      { label: "Copy Link", icon: "copy", value: "copy" },
      { label: "Open Link", icon: "external", value: "open" },
      { label: "Revoke Link…", icon: "trash", value: "revoke" },
    ], { title: `"${link.folder}"` });
    if (action === "copy") {
      const copied = await host.copyText(link.link);
      showToast(copied ? describeCopiedShareLink(link.folder) : "The clipboard refused the copy; select the link and copy it.", copied ? "ok" : "error");
    } else if (action === "open") await host.openLink(link.link);
    else if (action === "revoke") await revoke(host, link);
  });
}

async function revoke(host: ShareHost, link: ShareLinkView): Promise<void> {
  const notice = describeRevokeShareNotice(link.folder);
  const choice = await showDialog({
    title: notice.message,
    message: notice.detail,
    severity: "danger",
    buttons: [{ id: "revoke", label: "Revoke Link", primary: true, danger: true }],
  });
  if (choice !== "revoke") return;
  const progress = openProgressDialog({ title: "Revoking link", message: `Revoking the link to "${link.folder}"…` });
  let revoked: boolean;
  try {
    revoked = await host.revokeLink(link.id);
  } finally {
    progress.close();
  }
  showToast(describeRevokeShareOutcome(link.folder, revoked, host.place), "ok");
}
