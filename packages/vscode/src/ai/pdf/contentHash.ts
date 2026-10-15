// Hashes a paper's PDF bytes so the indexer can skip unchanged files.
import * as vscode from "vscode";
import type { LocalFileSystem } from "@labshelf/core";

/**
 * Computes a SHA-1 hex digest of the file at `uri`.
 *
 * @returns 40-character lowercase hex string.
 */
export async function hashFile(
  uri: vscode.Uri,
  fileSystem: Pick<LocalFileSystem, "readFile">,
): Promise<string> {
  const bytes = await fileSystem.readFile(uri.fsPath);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
