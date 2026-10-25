// Asks where the library should live and records the answer in the shared config.
import * as os from "node:os";
import * as vscode from "vscode";

import { formatError, type ILogger } from "@labshelf/core";
import {
  createDeviceLocalLayout,
  detectSyncFolders,
  detectLibraryFolder,
  type SyncFolder,
} from "@labshelf/core/node";
import type { SharedLibraryConfig } from "../../storage/paths/index.js";
import {
  libraryTargetFolder,
  displayPath,
  LIBRARY_FOLDER_NAME,
  syncToolName,
} from "./syncFolders/index.js";
import * as path from "node:path";

type FirstRunChoice =
  | { kind: "folder"; path: string; label: string; detail: string }
  | { kind: "browse"; label: string }
  | { kind: "guide"; label: string };

export function firstRunChoices(detected: readonly SyncFolder[], home: string): FirstRunChoice[] {
  const synced = detected.map((folder): FirstRunChoice => {
    const target = path.join(folder.path, LIBRARY_FOLDER_NAME);
    return { kind: "folder", path: target, label: displayPath(target, home), detail: `synced by ${syncToolName(folder.tool)}` };
  });
  const local = path.join(home, LIBRARY_FOLDER_NAME);
  return [
    ...synced,
    { kind: "folder", path: local, label: displayPath(local, home), detail: "only on this computer" },
    { kind: "browse", label: "Choose a folder…" },
    { kind: "guide", label: "How to sync between computers…" },
  ];
}

export interface ChooseLibraryRootDeps {
  sharedLibraryConfig: SharedLibraryConfig;
  createLogger(appLogPath: string): ILogger;
}

type PickedChoice = vscode.QuickPickItem & { choice: FirstRunChoice };

async function browseForFolder(): Promise<string | undefined> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select library folder",
    title: "LabShelf: Choose Library Folder",
  });
  const picked = folders?.[0];
  return picked ? libraryTargetFolder(picked.fsPath) : undefined;
}

// An existing library is opened as it is, so the user never ends up with two libraries by accident.
async function confirmExistingLibrary(target: string): Promise<boolean> {
  const info = await detectLibraryFolder(target);
  if (!info.isLibrary) { return true; }
  const answer = await vscode.window.showInformationMessage(
    `Found your library with ${info.paperCount} papers. Open it?`, { modal: true }, "Open",
  );
  return answer === "Open";
}

async function record(target: string, deps: ChooseLibraryRootDeps): Promise<vscode.Uri | undefined> {
  const logger = deps.createLogger(createDeviceLocalLayout(target).appLogPath);
  try {
    await deps.sharedLibraryConfig.recordRoot(target, logger);
    await logger.log("INFO", "firstRun", "Library location chosen", { root: target });
    return vscode.Uri.file(target);
  } catch (error) {
    await logger.error("firstRun", error, { action: "record library root", root: target });
    await vscode.window.showErrorMessage(`LabShelf: Failed to use ${target}: ${formatError(error)}`);
    return undefined;
  }
}

/** @returns the chosen library root, or undefined when the user cancelled or the choice could not be saved */
export async function chooseLibraryRoot(deps: ChooseLibraryRootDeps): Promise<vscode.Uri | undefined> {
  const home = os.homedir();
  const detected = await detectSyncFolders({ home, env: process.env, platform: process.platform });
  for (;;) {
    const items: PickedChoice[] = firstRunChoices(detected, home).map((choice) => ({
      label: choice.label, ...(choice.kind === "folder" ? { detail: choice.detail } : {}), choice,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: "LabShelf: Where should your library live?" });
    if (!picked) { return undefined; }
    if (picked.choice.kind === "guide") {
      await vscode.commands.executeCommand("labshelf.syncGuide");
      continue;
    }
    const target = picked.choice.kind === "folder" ? picked.choice.path : await browseForFolder();
    if (target && await confirmExistingLibrary(target)) { return record(target, deps); }
  }
}
