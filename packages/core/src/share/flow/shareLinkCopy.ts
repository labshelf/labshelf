// Words the messages and confirmations every app shows for share links.
import type { OpenShareError } from "../openShare.js";
import type { SharedImportOutcome } from "../importSharedPapers.js";
import { formatError } from "../../logging/index.js";
import type { ShareFolderStage } from "./shareFolder.js";

export const OPEN_SHARE_FAILURE: Record<OpenShareError, string> = {
  malformedLink: "LabShelf could not read that share link.",
  removed: "This link was removed by the person who shared it.",
  unreadable: "The link's key does not open this share; check that the link was copied whole.",
  network: "LabShelf could not reach the relay that serves this share.",
};

export function describeRefusedShareLink(parseError: string): string {
  return `${OPEN_SHARE_FAILURE.malformedLink} (${parseError})`;
}

export function describeSharedImport(summary: SharedImportOutcome, folderName: string, withAnnotations: boolean): string {
  const added = summary.added.length;
  const parts = [added > 0 ? `Imported ${added} of the shared papers into "${folderName}".` : "Every shared paper is already in your library."];
  if (added > 0 && summary.duplicates.length > 0) { parts.push(`${summary.duplicates.length} already in your library.`); }
  if (summary.missingPdfs.length > 0) { parts.push(`${summary.missingPdfs.length} without their PDF, which the relay could not serve.`); }
  // The sidecar store adds annotations only as new ones of the reader, so shared annotations are not copied.
  if (withAnnotations) { parts.push("Shared annotations are not imported."); }
  return parts.join(" ");
}

export interface ShareNoticeText { message: string; detail: string }

/** The notice before a share; its two choices are `SHARE_WITH_ANNOTATIONS` and `SHARE_WITHOUT_ANNOTATIONS`. */
export function describeShareRightsNotice(folder: { label: string; count: number }): ShareNoticeText {
  return {
    message: "You are responsible for having the right to share these papers.",
    detail: `Anyone with the link can read the ${folder.count} ${folder.count === 1 ? "paper" : "papers"} of "${folder.label}" and download their PDFs, until you revoke it.`,
  };
}

export const SHARE_WITH_ANNOTATIONS = "Share with my annotations";
export const SHARE_WITHOUT_ANNOTATIONS = "Share without annotations";

export function describeRevokeShareNotice(folder: string): ShareNoticeText {
  return {
    message: `Revoke the link to "${folder}"?`,
    detail: "The shared papers are deleted from your relay. Anyone who has the link can no longer open it, within about a minute.",
  };
}

export const SHARE_STAGE_TEXT: Record<ShareFolderStage, string> = { reading: "reading papers…", encrypting: "encrypting…", uploading: "uploading…" };

/** `place` is where the list of shares lives: "this device" or "this browser". */
export function describeRevokeShareOutcome(folder: string, revoked: boolean, place: string): string {
  return revoked ? `Revoked the link to "${folder}".` : `The link to "${folder}" is no longer listed on ${place}.`;
}

export function describeCopiedShareLink(folder: string): string {
  return `Copied the link to "${folder}".`;
}

export function describeShareFailure(action: string, error: unknown): string {
  return `LabShelf could not ${action}: ${formatError(error)}`;
}
