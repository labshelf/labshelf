// Starts a desktop share's Node disk mirror only while this window holds the project folder's lease.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import * as vscode from "vscode";
import * as path from "node:path";
import { contentConflictMessage, leasedMirrorFactory, readConflictDismissals, type ILogger, type MirrorFactory } from "@labshelf/core";
import { conflictDismissalFile, createDeviceIdentity, deviceLocalLayout, mergeText, NodeLibraryFileSystem, nodeMirrorDisk } from "@labshelf/core/node";
import { watchConflictDismissals } from "./dismissalWatch.js";

export function desktopMirrorFactory(libraryRoot: string, logger: ILogger, isEditorOwned: (folder: string, path: string) => boolean): MirrorFactory {
  const candidates = new Map<string, Set<string>>();
  const held = (folder: string): Set<string> => {
    if (!candidates.has(folder)) candidates.set(folder, new Set());
    return candidates.get(folder)!;
  };
  return leasedMirrorFactory({
    identity: createDeviceIdentity(deviceLocalLayout(libraryRoot), logger),
    fs: new NodeLibraryFileSystem(), app: "vscode", logger, mergeText,
    disk: (folder) => watchConflictDismissals(nodeMirrorDisk(folder, logger), conflictDismissalFile(libraryRoot), held(folder), logger), isEditorOwned,
    readConflictDismissals: () => readConflictDismissals(new NodeLibraryFileSystem(), conflictDismissalFile(libraryRoot)),
    onConflictCopy: (folder, copy) => {
      held(folder).add(path.relative(folder, copy.copy).split(path.sep).join('/'));
      void vscode.window.showInformationMessage(contentConflictMessage(copy), "Resolve").then((choice) => {
        if (choice === "Resolve") { void vscode.commands.executeCommand("labshelf.resolveConflicts"); }
      });
    },
  });
}
