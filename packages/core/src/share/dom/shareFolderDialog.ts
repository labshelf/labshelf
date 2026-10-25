// Walks the user through sharing a paper folder as a link: rights notice, progress, then the link.
import { openProgressDialog, showDialog, showToast } from "../../ui/dom/index.js";
import type { ShareHost, ShareProgress } from "../../libraryUi/share/index.js";
import { SHARE_STAGE_TEXT, SHARE_WITHOUT_ANNOTATIONS, SHARE_WITH_ANNOTATIONS, describeCopiedShareLink, describeShareRightsNotice } from "../flow/index.js";
import { showNoticeDialog } from "./noticeDialog.js";
import { reportFailure } from "./reportFailure.js";

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
