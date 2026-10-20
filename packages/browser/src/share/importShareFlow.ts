// Copies the papers of a pasted share link into the library, in a new folder named after the shared one, with progress and a summary.
import {
  baseName, createWorkerShareReader, OPEN_SHARE_FAILURE, parseShareLink, refusedShareLinkText, SHARE_PAGE_ORIGIN, shareImportSummaryText,
} from "@labshelf/core";
import { inputBox, showDialog } from "@labshelf/core/dom";
import { reportShareFailure, type ShareLinkPage } from "./shareLinkPage";

const PROGRESS = "Importing shared papers…";

function askLink(): Promise<string | undefined> {
  return inputBox({
    title: "Import Share Link", prompt: "Paste a share link", placeholder: `${SHARE_PAGE_ORIGIN}/share/#…`,
    validate: (value) => {
      if (value.trim() === "") return "Paste a share link";
      const parsed = parseShareLink(value.trim());
      return parsed.ok ? null : refusedShareLinkText(parsed.error);
    },
  });
}

export async function importShareFlow(page: ShareLinkPage): Promise<void> {
  const text = (await askLink())?.trim();
  if (!text) return;
  page.progress(PROGRESS);
  let result;
  try {
    result = await page.importLink({
      text, readerFor: (relayUrl) => createWorkerShareReader({ relayUrl }),
      onProgress: (count, total) => page.progress(`Importing shared papers: ${count} of ${total}`),
    });
    if (result.status === "imported" && result.summary.added.length > 0) await page.refresh();
  } catch (error) {
    reportShareFailure(page, "import the shared papers", error, {});
    return;
  } finally {
    page.progress(null);
  }
  if (result.status === "refused") { page.notice("error", refusedShareLinkText(result.error)); return; }
  if (result.status === "openFailed") { page.notice("error", OPEN_SHARE_FAILURE[result.error]); return; }
  const { folder } = result.summary;
  const summary = shareImportSummaryText(result.summary, folder ? baseName(folder, "/") : "", result.withAnnotations);
  if (!folder) { page.notice("info", summary); return; }
  const choice = await showDialog({ title: "Imported the shared papers", message: summary, severity: "info", buttons: [{ id: "open", label: "Open Folder", primary: true }] });
  if (choice === "open") page.openFolder(folder);
}
