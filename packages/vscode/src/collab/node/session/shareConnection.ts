// Connects a shared project on the desktop: the core share connection over this library's state dir, folder and Node disk mirror.
import {
  connectShare,
  type ILogger,
  type InviteRelay,
  type ShareConnection,
  type ShareStart,
  describeContentConflict,
  createLeasedMirrorFactory,
  readConflictDismissals,
  type MirrorFactory,
} from "@labshelf/core";
import {
  createNodeCollabStorage,
  createNodeProjectCatalogCompositionRoot,
  resolveConflictDismissalFile,
  createDeviceIdentity,
  createDeviceLocalLayout,
  mergeText,
  NodeLibraryFileSystem,
  createNodeMirrorFileSystem,
} from "@labshelf/core/node";
import { shareStateDir } from "./shareState.js";
import * as vscode from "vscode";
import * as path from "node:path";
import { watchConflictDismissals } from "./dismissalWatch.js";

export function createDesktopMirrorFactory(libraryRoot: string, logger: ILogger, isEditorOwned: (folder: string, path: string) => boolean): MirrorFactory {
  const candidates = new Map<string, Set<string>>();
  const held = (folder: string): Set<string> => {
    if (!candidates.has(folder)) candidates.set(folder, new Set());
    return candidates.get(folder)!;
  };
  return createLeasedMirrorFactory({
    identity: createDeviceIdentity(createDeviceLocalLayout(libraryRoot), logger),
    fs: new NodeLibraryFileSystem(), app: "vscode", logger, mergeText,
    disk: (folder) => watchConflictDismissals(createNodeMirrorFileSystem(folder, logger), resolveConflictDismissalFile(libraryRoot), held(folder), logger), isEditorOwned,
    readConflictDismissals: () => readConflictDismissals(new NodeLibraryFileSystem(), resolveConflictDismissalFile(libraryRoot)),
    onConflictCopy: (folder, copy) => {
      held(folder).add(path.relative(folder, copy.copy).split(path.sep).join('/'));
      void vscode.window.showInformationMessage(describeContentConflict(copy), "Resolve").then((choice) => {
        if (choice === "Resolve") { void vscode.commands.executeCommand("labshelf.resolveConflicts"); }
      });
    },
  });
}

interface ConnectOptions {
  libraryRoot: string;
  shareId: string;
  shareKey: Uint8Array;
  /** The invite's relays, tried while the index lists none. */
  relays: readonly InviteRelay[];
  /** This user's name in the presence peers see. */
  name: string;
  logger: ILogger;
  /** True for a path of the folder an open editor holds. */
  isEditorOwned(folder: string, path: string): boolean;
}

export function connectDesktopShare(options: ConnectOptions, start: ShareStart): Promise<ShareConnection> {
  const { libraryRoot, shareId, shareKey, relays, name, logger } = options;
  return connectShare({
    shareId, shareKey, relays, name, logger,
    storage: createNodeCollabStorage({ dir: shareStateDir(libraryRoot, shareId), shareId }),
    projects: { context: createNodeProjectCatalogCompositionRoot(logger), libraryRoot },
    startMirror: createDesktopMirrorFactory(libraryRoot, logger, (folder, path) => options.isEditorOwned(folder, path)),
  }, start);
}
