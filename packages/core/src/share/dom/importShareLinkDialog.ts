// Imports the papers of a share link: asks for the link, shows progress, then offers the new folder.
import { askInputBox, openProgressDialog, showDialog, showToast } from "../../ui/dom/index.js";
import type { ShareLinkImportResult, ShareHost } from "../index.js";
import { parseShareLink } from "../shareLink.js";
import { describeRefusedShareLink } from "../flow/index.js";
import { showNoticeDialog } from "./noticeDialog.js";
import { reportFailure } from "./reportFailure.js";

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
