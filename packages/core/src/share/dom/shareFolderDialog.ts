// Walks the user through sharing a paper folder as a link: rights notice, progress, then the link.
import { progressDialog, showDialog, toast } from "../../ui/dom/index.js";
import type { ShareHost, ShareProgress } from "../../libraryUi/share/index.js";
import { SHARE_STAGE_TEXT, SHARE_WITHOUT_ANNOTATIONS, SHARE_WITH_ANNOTATIONS, copiedLinkText, shareRightsNotice } from "../flow/index.js";
import { infoDialog } from "./noticeDialog.js";
import { reportingFailure } from "./reportFailure.js";

export function runShareFolderDialog(host: ShareHost, path: string): Promise<void> {
  return reportingFailure("share the folder", async () => {
    const folder = await host.shareableFolder(path);
    if (!folder) { toast("This folder holds no papers to share.", "info"); return; }
    const notice = shareRightsNotice(folder);
    const choice = await showDialog({
      title: notice.message,
      message: notice.detail,
      buttons: [
        { id: "without", label: SHARE_WITHOUT_ANNOTATIONS },
        { id: "with", label: SHARE_WITH_ANNOTATIONS, primary: true },
      ],
    });
    if (!choice) return;
    const progress = progressDialog({ title: `Sharing "${folder.label}"`, message: `Sharing "${folder.label}"…` });
    let result;
    try {
      result = await host.shareFolder(path, choice === "with", (p: ShareProgress) => {
        if ("stage" in p) progress.update(`Sharing "${folder.label}": ${SHARE_STAGE_TEXT[p.stage]}`);
      });
    } finally {
      progress.close();
    }
    if (result.kind === "noRelay") {
      await infoDialog("Connect Cloudflare to share", "Share links live on your Cloudflare relay. Connect Cloudflare to share a folder.");
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
    toast(again ? copiedLinkText(label) : "The clipboard refused the copy; select the link and copy it.", again ? "ok" : "error");
  }
}
