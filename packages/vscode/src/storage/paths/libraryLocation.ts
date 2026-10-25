/**
 * Resolves the central LabShelf library directory, whose root lives in the config file shared with the
 * terminal app so both open the same library.
 */
import * as vscode from "vscode";

import { createLibraryLayout, type IFileSystem } from "@labshelf/core";
import type { SharedLibraryConfig } from "./sharedLibraryConfig.js";

/**
 * Reads the library root from the shared config and validates that it still exists on disk.
 * @returns URI of the library root, or undefined if unset or inaccessible
 */
export async function resolveLibraryRoot(sharedConfig: SharedLibraryConfig): Promise<vscode.Uri | undefined> {
  // CONTRACT: documents/contracts/library-format.md#shared-configuration
  const stored = await sharedConfig.readRoot();
  if (!stored) {
    return undefined;
  }

  const uri = vscode.Uri.file(stored);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.Directory) {
      return undefined;
    }
    return uri;
  } catch {
    // Path is not accessible
    return undefined;
  }
}

/**
 * Creates all required LabShelf subdirectories under root if they do not already exist.
 */
export async function ensureLibraryStructure(root: vscode.Uri, fileSystem: IFileSystem): Promise<void> {
  for (const dir of createLibraryLayout(root, vscode.Uri.joinPath).requiredDirs()) {
    await fileSystem.ensureDir(dir.fsPath);
  }
}
