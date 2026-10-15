/**
 * Resolves and sets up the central LabShelf library directory, whose root lives in the config file shared with the
 * terminal app so both open the same library.
 */
import * as vscode from "vscode";

import { libraryLayout, type IFileSystem } from "@labshelf/core";
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
  for (const dir of libraryLayout(root, vscode.Uri.joinPath).requiredDirs()) {
    await fileSystem.ensureDir(dir.fsPath);
  }
}

/**
 * Runs the first-use folder-picker wizard, creates the library structure at the chosen location through the file
 * system the factory returns for it, and records the root in the shared config.
 * @returns the configured library root URI, or undefined if the user cancelled
 */
export async function runLibrarySetupWizard(
  sharedConfig: SharedLibraryConfig,
  createFileSystem: (root: vscode.Uri) => IFileSystem,
): Promise<vscode.Uri | undefined> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select base folder for library",
    title: "LabShelf: Choose Library Location",
  });

  if (!folders || folders.length === 0) {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const baseFolderUri = folders[0]!;

  const name = await vscode.window.showInputBox({
    prompt: "Library folder name (will be created inside the selected folder)",
    placeHolder: "LabShelfLibrary",
    value: "LabShelfLibrary",
    validateInput: (v) => (v.trim() ? undefined : "Name cannot be empty"),
  });

  if (!name?.trim()) {
    return undefined;
  }

  const libraryRoot = vscode.Uri.joinPath(baseFolderUri, name.trim());

  try {
    const fileSystem = createFileSystem(libraryRoot);
    await fileSystem.ensureDir(libraryRoot.fsPath);
    await ensureLibraryStructure(libraryRoot, fileSystem);
    await sharedConfig.recordRoot(libraryRoot.fsPath);
    return libraryRoot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`LabShelf: Failed to create library at ${libraryRoot.fsPath}: ${message}`);
    return undefined;
  }
}
