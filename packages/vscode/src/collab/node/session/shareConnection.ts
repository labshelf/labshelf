// Connects a shared project on the desktop: the core share connection over this library's state dir, folder and Node disk mirror.
import * as path from "node:path";

import { connectShare, startProjectMirror, type ILogger, type InviteRelay, type ShareConnection, type ShareStart } from "@labshelf/core";
import { deviceLocalLayout, mergeText, nodeCollabStorage, nodeMirrorDisk, nodeProjectCatalogContext } from "@labshelf/core/node";

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
  const dir = path.join(deviceLocalLayout(libraryRoot).collabDir, shareId);
  return connectShare({
    shareId, shareKey, relays, name, logger,
    storage: nodeCollabStorage({ dir, shareId }),
    projects: { context: nodeProjectCatalogContext(logger), libraryRoot },
    startMirror: async ({ folder, session, blobs, store, onStopped }) => ({
      kind: "running",
      mirror: startProjectMirror({
        folder, disk: nodeMirrorDisk(folder, logger), mergeText, session, blobs, store, logger,
        isEditorOwned: (file) => options.isEditorOwned(folder, file), onStopped: (reason) => onStopped(reason.message),
      }),
    }),
  }, start);
}
