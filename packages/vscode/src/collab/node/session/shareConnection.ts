// Connects a shared project on the desktop: the core share connection over this library's state dir, folder and Node disk mirror.
import {
  connectShare,
  type ILogger,
  type InviteRelay,
  type ShareConnection,
  type ShareStart,
  contentConflictMessage,
  leasedMirrorFactory,
  readConflictDismissals,
  type MirrorFactory,
} from "@labshelf/core";
import {
  nodeCollabStorage,
  nodeProjectCatalogContext,
  conflictDismissalFile,
  createDeviceIdentity,
  deviceLocalLayout,
  mergeText,
  NodeLibraryFileSystem,
  nodeMirrorDisk,
} from "@labshelf/core/node";
import { shareStateDir } from "./shareState.js";
import * as vscode from "vscode";
import * as path from "node:path";
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
    storage: nodeCollabStorage({ dir: shareStateDir(libraryRoot, shareId), shareId }),
    projects: { context: nodeProjectCatalogContext(logger), libraryRoot },
    startMirror: desktopMirrorFactory(libraryRoot, logger, (folder, path) => options.isEditorOwned(folder, path)),
  }, start);
}
