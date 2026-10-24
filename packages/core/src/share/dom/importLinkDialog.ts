// Imports the papers of a share link: asks for the link, shows progress, then offers the new folder.
import { inputBox, progressDialog, showDialog, toast } from "../../ui/dom/index.js";
import type { ImportLinkResult, SharingHost } from "../../libraryUi/share/index.js";
import { parseShareLink } from "../format/index.js";
import { refusedShareLinkText } from "../workflow/index.js";
import { infoDialog } from "./infoDialog.js";
import { reportingFailure } from "./reportFailure.js";

export function runImportLinkDialog(host: SharingHost, link?: string): Promise<void> {
  return reportingFailure("import the shared link", async () => {
    const text = link ?? await inputBox({
      title: "Import Shared Link",
      prompt: "Paste a share link",
      validate: linkProblem,
    });
    if (!text) return;
    const progress = progressDialog({ title: "Importing shared papers", message: "Importing shared papers…" });
    let result: ImportLinkResult;
    try {
      result = await host.importLink(text, (p) => {
        if ("done" in p) progress.update(`Importing shared papers: ${p.done} of ${p.total}`);
      });
    } finally {
      progress.close();
    }
    if (result.kind === "failed") { await infoDialog("Could not import the link", result.message, "warning"); return; }
    if (!result.folder) { toast(result.summary, "info"); return; }
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
  return parsed.ok ? null : refusedShareLinkText(parsed.error);
}
