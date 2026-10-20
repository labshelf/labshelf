// Words what every app tells the user about share links, so the browser and VS Code say the same thing.
import type { OpenShareError } from "../openShare.js";
import type { SharedImportSummary } from "../importSharedPapers.js";

export const OPEN_SHARE_FAILURE: Record<OpenShareError, string> = {
  malformedLink: "LabShelf could not read that share link.",
  removed: "This link was removed by the person who shared it.",
  unreadable: "The link's key does not open this share; check that the link was copied whole.",
  network: "LabShelf could not reach the relay that serves this share.",
};

export function refusedShareLinkText(parseError: string): string {
  return `${OPEN_SHARE_FAILURE.malformedLink} (${parseError})`;
}

export function shareImportSummaryText(summary: SharedImportSummary, folderName: string, withAnnotations: boolean): string {
  const added = summary.added.length;
  const parts = [added > 0 ? `Imported ${added} of the shared papers into "${folderName}".` : "Every shared paper is already in your library."];
  if (added > 0 && summary.duplicates.length > 0) { parts.push(`${summary.duplicates.length} already in your library.`); }
  if (summary.missingPdfs.length > 0) { parts.push(`${summary.missingPdfs.length} without their PDF, which the relay could not serve.`); }
  // The sidecar store adds annotations only as new ones of the reader, so shared annotations are not copied.
  if (withAnnotations) { parts.push("Shared annotations are not imported."); }
  return parts.join(" ");
}

export interface ShareConfirmText { message: string; detail: string }

/** The notice before a share; its two choices are `SHARE_WITH_ANNOTATIONS` and `SHARE_WITHOUT_ANNOTATIONS`. */
export function shareRightsNotice(folder: { label: string; count: number }): ShareConfirmText {
  return {
    message: "You are responsible for having the right to share these papers.",
    detail: `Anyone with the link can read the ${folder.count} papers of "${folder.label}" and download their PDFs, until you revoke it.`,
  };
}

export const SHARE_WITH_ANNOTATIONS = "Share with my annotations";
export const SHARE_WITHOUT_ANNOTATIONS = "Share without annotations";

export function revokeShareConfirm(folder: string): ShareConfirmText {
  return {
    message: `Revoke the link to "${folder}"?`,
    detail: "The shared papers are deleted from your relay. Anyone who has the link can no longer open it, within about a minute.",
  };
}
