// Writes the vscode:// URI through which the share page asks LabShelf in VS Code to import a share.
import { formatShareLink, type ShareLinkParts } from "./shareLink.js";

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
/** `<publisher>.<name>` of the VS Code extension; VS Code routes a vscode:// URI to the extension its authority names. */
export const VSCODE_EXTENSION_ID = "labshelf.labshelf";
export const SHARE_IMPORT_PATH = "/importShare";

export function formatShareImportUri(link: ShareLinkParts): string {
  return `vscode://${VSCODE_EXTENSION_ID}${SHARE_IMPORT_PATH}?link=${encodeURIComponent(formatShareLink(link))}`;
}
